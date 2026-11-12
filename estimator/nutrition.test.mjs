import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { calculateNutrition, NutritionCache, nutritionTask, SOURCE_TTL_MS } from './nutrition.mjs';

const item = (overrides = {}) => ({
  identity: 'Example yogurt', variant: 'plain, 0% fat', region: 'US', dish: 0,
  amount: 255, basisAmount: 170, unit: 'g',
  calories: 100, protein: 18, carbs: 7, fat: 0, fiber: 0, alcohol: 0,
  basis: 'label', url: 'https://example.com/plain-yogurt',
  excerpt: 'Per 170 g: 100 kcal, 18 g protein, 7 g total carbs, 0 g fat, 0 g fiber.', ...overrides,
});
const evidence = (...items) => ({ complete: true, items });

test('scale a label by weight, preserve its calories and include fiber and ethanol', () => {
  const values = calculateNutrition(evidence(item({calories:95}), item({ identity: 'Drink', amount: 1, basisAmount: 1, unit: 'glass', calories: 98, protein: 0, carbs: 0, fat: 0, alcohol: 14 })));
  assert.deepEqual(values.whole, { calories: 240.5, protein: 27, carbs: 10.5, fat: 0, fiber: 0, alcohol: 14 });
  assert.equal(calculateNutrition(evidence(item({ fiber: 3 }))).whole.fiber, 4.5);
});

test('shared dishes add up after rounding and a missing dish cannot become zero', () => {
  const computed = calculateNutrition(evidence(item({ amount: 1, basisAmount: 3, calories: 1 }), item({ dish: 1, amount: 1, basisAmount: 3, calories: 1 })), 2);
  assert.equal(computed.whole.calories, 0.6);
  assert.equal(calculateNutrition(evidence(item()), 2), null);
});

test('reject partial research, invalid units, missing citations and impossible values', () => {
  assert.equal(calculateNutrition({ complete: false, items: [item()] }), null);
  for (const bad of [{ amount: -1 }, { basisAmount: 0 }, { unit: '' }, { region: '' }, { url: 'file:///label' }, { excerpt: '' }, { fiber: 8 }, { protein: Infinity }, { calories: 1e20 }, { dish: 1 }, { amount: '10' }]) {
    assert.equal(calculateNutrition(evidence(item(bad))), null, JSON.stringify(bad));
  }
});

test('cache persists only complete labels, keys exact descriptions and notes, and expires', t => {
  const dir = mkdtempSync(join(tmpdir(), 'athx-nutrition-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'sources.json');
  let now = 1000;
  const cache = new NutritionCache(file, { now: () => now, limit: 2 });
  const key = cache.key('plain yogurt 255 g; US', 'meal');
  cache.put(key, evidence(item()));
  assert.ok(new NutritionCache(file, { now: () => now }).get(key));
  for (const changed of ['vanilla yogurt 255 g; US', 'plain yogurt 170 g; US', 'plain yogurt 255 g; UK', 'plain yogurt 255 g; US; foodNotes: new label']) {
    assert.equal(cache.get(cache.key(changed, 'meal')), null);
  }
  assert.equal(cache.get(cache.key('plain yogurt 255 g; US', 'dishes')), null);
  const returned = cache.get(key);
  returned.evidence.items[0].calories = 900;
  assert.equal(cache.get(key).evidence.items[0].calories, 100);
  cache.put('reference', evidence(item({ basis: 'reference' })));
  cache.put('incomplete', { complete: false, items: [item()] });
  assert.equal(cache.get('reference'), null);
  assert.equal(cache.get('incomplete'), null);
  now += SOURCE_TTL_MS;
  assert.equal(cache.get(key), null);
  writeFileSync(file, '{broken');
  assert.equal(new NutritionCache(file).get(key), null);
});

test('server task replaces model arithmetic, lowers unsupported confidence and shares valid evidence', () => {
  let shared;
  const base = { name: 'meal', schema: { properties: {}, required: [] }, instructions: '', clean: value => value };
  const task = nutritionTask(base, value => { shared = value; });
  const answer = task.clean({ name: 'Yogurt', calories: 999, confidence: 'high', assumptions: 'A portion.', nutrition: evidence(item({ basis: 'reference', url: '', excerpt: '' })) });
  assert.equal(answer.calories, 150);
  assert.equal(answer.confidence, 'medium');
  assert.ok(shared);
  assert.match(answer.assumptions, /255\/170/);
  shared = null;
  const fallback = task.clean({ calories: 999, nutrition: { complete: false, items: [] } });
  assert.equal(fallback.calories, 999);
  assert.equal(shared, null);
});

test('sources lower a provider confidence but never raise it, for the meal and each dish', () => {
  const base = { name: 'meal', schema: { properties: {}, required: [] }, instructions: '', clean: value => value };
  const stand = item({ basis: 'reference', url: '', excerpt: '' });
  const notFound = nutritionTask(base, () => {}).clean({ name: 'Bar', confidence: 'low', assumptions: 'Exact product not found.', nutrition: evidence(stand) });
  assert.equal(notFound.confidence, 'low', 'a product that was not found stays low');
  assert.equal(nutritionTask(base, () => {}).clean({ name: 'Bar', nutrition: evidence(item()) }).confidence, 'low', 'an unstated confidence is low, as clean() reads it');
  const dishes = nutritionTask({ ...base, name: 'dishes' }, () => {}).clean({
    name: 'Shared', confidence: 'high', assumptions: '',
    dishes: [{ name: 'Bar', confidence: 'low' }, { name: 'Yogurt', confidence: 'high' }],
    nutrition: evidence(stand, item({ dish: 1 })),
  });
  assert.deepEqual(dishes.dishes.map(dish => dish.confidence), ['low', 'high']);
  assert.equal(dishes.confidence, 'medium', 'the meal stays no higher than its weakest basis');
});

const { verifyNutritionEvidence, publicIPv4, excerptSupports } = await import('./source-page.mjs');

test('each label figure and the serving must sit beside its own name', () => {
  const prose = item().excerpt;
  assert.equal(excerptSupports(item(), prose), true);
  assert.equal(excerptSupports(item({ protein: 7, carbs: 18 }), prose), false, 'transposed protein and carbs');
  assert.equal(excerptSupports(item({ basisAmount: 18 }), prose), false, 'the protein figure is not a serving');
  assert.equal(excerptSupports(item(), 'Per 170 g: 100 kcal, 18 g protein, 7 g total carbs, 0 g fat.'), false, 'a zero the excerpt never states');
  assert.equal(excerptSupports(item(), 'Per 170 g: 100 kcal, 18 g protein, 7 g total carbs, 0 g fat, 0 g fiber, 5% alcohol.'), false, 'ethanol mentioned but not in grams');

  const us = 'Nutrition Facts 8 servings per container Serving size 2/3 cup (55g) Amount per serving Calories 230 Total Fat 8g 10% Saturated Fat 1g 5% Trans Fat 0g Cholesterol 0mg 0% Sodium 160mg 7% Total Carbohydrate 37g 13% Dietary Fiber 4g 14% Total Sugars 12g Includes 10g Added Sugars 20% Protein 3g';
  const bar = { basisAmount: 55, unit: 'g', calories: 230, protein: 3, carbs: 37, fat: 8, fiber: 4, alcohol: 0 };
  assert.equal(excerptSupports(item(bar), us), true, 'a printed US label');
  for (const [wrong, why] of [
    [{ fat: 1 }, 'saturated fat is not total fat'],
    [{ carbs: 4, fiber: 37 }, 'fiber and carbs transposed'],
    [{ carbs: 160 }, 'sodium in mg'],
    [{ fat: 10 }, 'a daily value percentage'],
    [{ basisAmount: 8 }, 'servings per container'],
  ]) assert.equal(excerptSupports(item({ ...bar, ...wrong }), us), false, why);

  const eu = 'Typical values per 100 g: Energy 1046 kJ / 250 kcal, Fat 8 g of which saturates 3 g, Carbohydrate 37 g of which sugars 12 g, Fibre 4 g, Protein 3 g';
  const biscuit = { ...bar, basisAmount: 100, calories: 250 };
  assert.equal(excerptSupports(item(biscuit), eu), true, 'an EU label, kcal beside kJ');
  assert.equal(excerptSupports(item({ ...biscuit, calories: 1046 }), eu), false, 'kJ is not kcal');
  assert.equal(excerptSupports(item({ ...biscuit, fat: 3 }), eu), false, 'saturates are not total fat');
});


test('only a verifiable verbatim label excerpt is eligible for persistence', async () => {
  let reads = 0;
  const first = item();
  const readPage = async () => { reads++; return `<html><p>${first.excerpt}</p></html>`; };
  assert.equal(await verifyNutritionEvidence(evidence(first, item({ amount: 170 })), { readPage }), true);
  assert.equal(reads, 1, 'one page read per URL');
  assert.equal(await verifyNutritionEvidence(evidence(item({calories:999})), {readPage}), false, 'a real excerpt cannot support invented basis values');
  assert.equal(await verifyNutritionEvidence(evidence(first), { readPage: async () => 'Page unavailable' }), false);
  assert.equal(await verifyNutritionEvidence(evidence(first), { readPage: async () => null }), false);
  assert.equal(await verifyNutritionEvidence(evidence(item({ basis: 'estimated' })), { readPage }), false);
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','172.16.1.1','192.168.1.1','0.0.0.0','224.0.0.1','::1','198.18.0.1']) assert.equal(publicIPv4(ip),false,ip);
  assert.equal(publicIPv4('8.8.8.8'),true);
});

test('untrusted dish counts and truthy completeness cannot allocate or calculate', () => {
  for (const count of [0, -1, 1.5, 21, 1e9, NaN, '2']) assert.equal(calculateNutrition(evidence(item()), count), null);
  assert.equal(calculateNutrition({complete:'yes', items:[item()]}), null);
});

test('only calculated ingredient brackets reach the phone parser and reply notes survive', () => {
  const base = {name:'meal',schema:{properties:{},required:[]},instructions:'',clean:value=>value};
  const result = nutritionTask(base,()=>{}).clean({
    name:'Yogurt',calories:999,assumptions:'Yogurt, 255 g [999 kcal, 999P, 999C, 999F]',confidence:'high',
    nutrition:{...evidence(item()),notes:'The corrected portion is used.'},
  });
  assert.match(result.assumptions,/\[150 kcal, 27P, 10.5C, 0F\]/);
  assert.doesNotMatch(result.assumptions,/999/);
  assert.match(result.assumptions,/corrected portion/);
});

test('source conflicts can invalidate a persisted cache entry', () => {
  const cache = new NutritionCache(undefined);
  cache.put('meal',evidence(item()));
  assert.ok(cache.get('meal'));
  cache.forget('meal');
  assert.equal(cache.get('meal'),null);
});
