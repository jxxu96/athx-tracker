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
    const numbers = new Set((excerpt.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
    const supported = [item.basisAmount, ...FIGURES.map(key => item[key])]
      .every(value => value === 0 || numbers.has(value));
    return supported && typeof page === 'string' && excerpt.length >= 30 && normalized(page).includes(excerpt);
  }));
  return verified.every(Boolean);
}
