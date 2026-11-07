import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { NutritionCache } from './nutrition.mjs';

test('one source lookup is shared with peers and persisted for repeated meals', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'athx-source-sharing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls');
  // Seed a previously verified entry to exercise the actual persisted-cache
  // read path. The independent page check has its own controlled reader tests.
  const cache = new NutritionCache(join(dir, 'sources.json'));
  const source = {identity:'Example yogurt',variant:'plain',region:'US',dish:0,amount:255,basisAmount:170,unit:'g',calories:100,protein:18,carbs:7,fat:0,fiber:0,alcohol:0,basis:'label',url:'https://example.com/yogurt',excerpt:'170 g: 100 kcal, protein 18 g, carbs 7 g, fat 0 g, fiber 0 g.'};
  cache.put(cache.key('Previously verified yogurt, yogurt and yogurt','meal'), {complete:true,items:[source]});
  const fake = join(dir, 'provider');
  writeFileSync(fake, `#!/usr/bin/env node
const {appendFileSync} = require('node:fs');
const prompt = process.argv.at(-1);
appendFileSync(process.env.CALL_LOG, JSON.stringify({shared:prompt.includes('sharedNutritionEvidence')})+'\\n');
const item = {identity:'Example yogurt',variant:'plain',region:'US',dish:0,amount:255,basisAmount:170,unit:'g',calories:100,protein:18,carbs:7,fat:0,fiber:0,alcohol:0,basis:'label',url:'https://example.com/yogurt',excerpt:'170 g: 100 kcal, protein 18 g, carbs 7 g, fat 0 g, fiber 0 g.'};
setTimeout(()=>console.log(JSON.stringify({name:'Yogurt',calories:999,protein:999,carbs:999,fat:999,fiber:0,alcohol:0,assumptions:'Exact label.',confidence:'high',nutrition:{complete:true,items:[item]}})),100);
`, { mode: 0o755 });
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const token = 'source-sharing-test-token';
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {...process.env, ESTIMATOR_TOKEN:token, ESTIMATOR_HOST:'127.0.0.1', ESTIMATOR_PORT:String(port), ESTIMATOR_ORDER:'codex,claude,grok', CODEX_BIN:fake, CLAUDE_BIN:fake, GROK_BIN:fake, CALL_LOG:log, NUTRITION_CACHE_FILE:join(dir,'sources.json'), BACKUP_URL:'', DEPLOY_WEBHOOK:''},
    stdio:['ignore','pipe','pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Estimator did not start')),10000);
    child.once('error', reject);
    child.stdout.on('data', data => { if (String(data).includes('listening on')) { clearTimeout(timer); resolve(); } });
  });
  const post = async description => {
    writeFileSync(log, '');
    const response = await fetch(`http://127.0.0.1:${port}`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({description,budgetMs:130000})});
    assert.equal(response.status,200);
    const answer = await response.json();
    assert.equal(answer.calories,150, 'code replaces the incorrect model total');
    assert.equal(answer.protein,27);
    return readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).map(call => call.shared);
  };
  assert.deepEqual(await post('Yogurt, yogurt and yogurt'),[false,true,true]);
  assert.deepEqual(await post('Previously verified yogurt, yogurt and yogurt'),[true,true,true]);
  assert.deepEqual(await post('Vanilla yogurt, yogurt and yogurt'),[false,true,true], 'variant changes cannot reuse cached evidence');
  assert.deepEqual(await post(JSON.stringify({mealDescription:'Yogurt, yogurt and yogurt',previousEstimate:{calories:150},replies:['Actually the vanilla variety']})),[false,true,true], 'corrections require fresh evidence');
});
