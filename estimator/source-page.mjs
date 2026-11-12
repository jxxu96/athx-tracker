/** Read only public HTTPS label pages. DNS is resolved once and pinned for the
 * connection, including redirects; a model-provided URL cannot target the LAN.
 */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { FIGURES } from './nutrition.mjs';

export function publicIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

export async function publicPage(url, signal, redirects = 0) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || redirects > 3) return null;
    const addresses = await lookup(parsed.hostname, { family: 4, all: true });
    if (!addresses.length || addresses.some(({ address }) => !publicIPv4(address)) || signal?.aborted) return null;
    return await new Promise(resolve => {
      const req = request(parsed, {
        signal,
        lookup: (_host, options, callback) => callback(null, options.all ? addresses : addresses[0].address, 4),
        headers: { 'User-Agent': 'ATHX-Nutrition-Source-Check/1.0', Accept: 'text/html,text/plain' },
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          resolve(publicPage(new URL(res.headers.location, parsed).href, signal, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
          if (body.length > 2_000_000) { res.destroy(); resolve(null); }
        });
        res.on('end', () => resolve(body));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  } catch { return null; }
}

const normalized = text => text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().toLowerCase();

// A figure counts only beside its own nutrient's name. A number anywhere in the
// excerpt is not enough: "18 g protein, 7 g total carbs" must not support
// protein 7 and carbs 18.
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const NAMES = {
  calories: String.raw`(?:calories|energy)`,
  protein: String.raw`proteins?`,
  carbs: String.raw`(?<!net )(?:total )?(?:carbohydrates?|carbs?)`,
  // The sub-lines of a label are other nutrients, not total fat or fiber.
  fat: String.raw`(?<!(?:saturated|sat\.?|trans|unsaturated|monounsaturated|polyunsaturated|from) )(?:total )?fats?`,
  fiber: String.raw`(?<!(?:soluble|insoluble) )(?:dietary |total )?fib(?:er|re)s?`,
  alcohol: String.raw`(?<!sugar )(?:alcohol|ethanol)`,
};
// A number in another unit is another quantity: sodium in mg, energy in kJ,
// a share of the daily value or of volume.
const ELSEWHERE = String.raw`(?!\.?\d)(?! ?(?:mg|mcg|kj|ml|oz)\b)(?! ?%)`;
const KCAL = new RegExp(String.raw`(?<![\d.])${NUMBER} ?(?:kcal|cal|calories)\b`, 'g');
const ORDERS = {
  // A printed label: "Total Fat 8g Protein 3g".
  nameFirst: Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, new RegExp(
    String.raw`\b${name}\b[ :|–-]{0,3}${NUMBER}${ELSEWHERE}${key === 'calories' ? String.raw`(?! ?g\b)` : ''}`, 'g',
  )])),
  // Prose: "18 g protein, 7 g total carbs". The unit is required, so a bare
  // number between two names is not read both ways. "250 kcal" names itself,
  // so it counts under either reading.
  valueFirst: Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, key === 'calories' ? KCAL : new RegExp(
    String.raw`(?<![\d.])${NUMBER} ?(?:g|grams?) (?:of )?${name}\b`, 'g',
  )])),
};
// The serving the figures are per, as a whole quantity and its unit: "per 100 g",
// "Serving size 2/3 cup (55g)", which is both 2/3 cup and 55 g, and "30 g
// serving". "Servings per container 8" is not one.
const QUANTITY = String.raw`(\d+ \d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?!\.?\d)`;
const UNIT = String.raw`(fl\.? ?oz|[a-z]+)`;
const SERVINGS = [
  [new RegExp(String.raw`\b(?:per|serving size|serving|portion size|portion)\b:? ?\(? ?${QUANTITY} ?${UNIT}?(?:[^()\d,;]{0,15}\( ?${QUANTITY} ?${UNIT}\b)?`, 'g')],
  // "1 serving" is per serving.
  [new RegExp(String.raw`(?<![\d./])${QUANTITY} ?(?:${UNIT} )?(?:serving|portion)\b`, 'g'), 'serving'],
];
const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8' };
const UNIT_NAMES = {
  gram: 'g', gr: 'g', gramme: 'g', milliliter: 'ml', millilitre: 'ml', ounce: 'oz', fluidounce: 'floz',
  tablespoon: 'tbsp', teaspoon: 'tsp', liter: 'l', litre: 'l',
};

/** One spelling per unit, singular: "Grams" and "g", "fl. oz" and "fl oz", "glasses" and "glass". */
const unitKey = unit => {
  const key = String(unit).toLowerCase().replace(/[.\s]/g, '').replace(/(?<=(?:s|x|ch|sh))es$/, '').replace(/(?<!s)s$/, '');
  return UNIT_NAMES[key] ?? key;
};

/** "55", "1.5", "2/3" or "1 1/2". A fraction is written rounded, so it is matched to within 0.005. */
const quantity = written => {
  const [, whole = '0', top, bottom] = written.match(/^(?:(\d+(?:\.\d+)?) )?(?:(\d+)\/(\d+))?$/) ?? written.match(/^(\d+(?:\.\d+)?)$/) ?? [];
  const value = Number(whole) + (top ? Number(top) / Number(bottom) : 0);
  return { value, tolerance: top ? 0.005 : 0 };
};

const servingsIn = text => SERVINGS.flatMap(([pattern, bare]) => [...text.matchAll(pattern)].flatMap(match => [
  [match[1], match[2] ?? bare], [match[3], match[4]],
].filter(([written, unit]) => written && unit).map(([written, unit]) => ({ ...quantity(written), unit: unitKey(unit) }))));

const numbersFrom = (pattern, text) => [...text.matchAll(pattern)].flatMap(match => match.slice(1)).filter(Boolean).map(Number);

/**
 * Whether the excerpt states this item's serving and each of its figures beside
 * the matching name. An excerpt reads one way throughout, so every figure must
 * hold under the same reading. A zero needs saying too, except ethanol, which a
 * food label leaves out.
 */
export function excerptSupports(item, excerpt) {
  const text = normalized(excerpt).replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/(\d)?([½⅓⅔¼¾⅛])/g, (_, whole, part) => `${whole ? `${whole} ` : ''}${VULGAR[part]}`);
  const unit = unitKey(item.unit);
  const served = servingsIn(text).some(serving => serving.unit === unit
    && Math.abs(serving.value - item.basisAmount) <= serving.tolerance);
  if (!served) return false;
  const kcal = numbersFrom(KCAL, text);
  return Object.entries(ORDERS).some(([reading, order]) => FIGURES.every(key => {
    const found = new Set(numbersFrom(order[key], text));
    if (key === 'calories' && reading === 'nameFirst') kcal.forEach(value => found.add(value));
    if (found.has(item[key])) return true;
    return key === 'alcohol' && item[key] === 0 && !new RegExp(String.raw`\b${NAMES.alcohol}\b`).test(text);
  }));
}

/** Unreadable/dynamic pages simply aren't cached. Never delay a partial answer. */
export async function verifyNutritionEvidence(evidence, { readPage = publicPage, signal } = {}) {
  if (!evidence?.complete || !evidence.items?.length || !evidence.items.every(i => i.basis === 'label')) return false;
  const pages = new Map();
  const bounded = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
  const verified = await Promise.all(evidence.items.map(async item => {
    if (!pages.has(item.url)) pages.set(item.url, readPage(item.url, bounded));
    const page = await pages.get(item.url);
    const excerpt = normalized(item.excerpt ?? '');
    // A substantial verbatim excerpt, rather than a URL/confidence claim alone.
    return excerptSupports(item, excerpt) && typeof page === 'string' && excerpt.length >= 30 && normalized(page).includes(excerpt);
  }));
  return verified.every(Boolean);
}
