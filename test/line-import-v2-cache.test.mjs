// Line Import v2 cache (packages/engine/line/importV2/cache.mjs): the logic map and the characterization results are kept
// by content hash under Line's state folder, written through the writer, so a second start does not redo them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { contentKey, createStateCache, CACHE_DIR } from '../packages/engine/line/importV2/cache.mjs';
import { buildLogicMap } from '../packages/engine/line/logicMap.mjs';

const SRC = "export function total(xs: number[]): number {\n  if (xs.length === 0) return 0;\n  return xs.reduce((a, b) => a + b, 0);\n}\n";

test('cache: a key depends on every part, and entries live under line/cache/<name>/ through the writer', () => {
  const dir = makeTempDir('construct-iv2-cache-');
  assert.equal(contentKey('a', { b: 1 }), contentKey('a', { b: 1 }));
  assert.notEqual(contentKey('a', 'b'), contentKey('ab'));
  const c = createStateCache(dir, 'logic-units');
  const k = contentKey('x');
  assert.equal(c.get(k), undefined, 'a miss is undefined, not an error');
  c.set(k, { n: 1 });
  assert.deepEqual(c.get(k), { n: 1 });
  assert.ok(fs.existsSync(path.join(dir, CACHE_DIR, 'logic-units', `${k}.json`)));
  fs.writeFileSync(path.join(dir, CACHE_DIR, 'logic-units', `${k}.json`), '{not json');
  assert.equal(c.get(k), undefined, 'a corrupt entry is a miss');
  assert.throws(() => createStateCache(dir, '../x'), /is not a cache name/);
});

test('cache: buildLogicMap keeps each file\'s units by content; an unchanged file is read from the cache, a changed one is parsed again', () => {
  const dir = makeTempDir('construct-iv2-cache-map-');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/total.ts'), SRC);
  const store = new Map();
  let sets = 0;
  const cache = { get: (k) => store.get(k), set: (k, v) => { sets += 1; store.set(k, v); } };
  const cold = buildLogicMap(dir, ['src/total.ts'], { cache });
  assert.equal(sets, 1);
  assert.ok(cold.units.length > 0);
  // A hit returns exactly what the parse did (planted to prove the cache was read).
  const key = [...store.keys()][0];
  const warm = buildLogicMap(dir, ['src/total.ts'], { cache });
  assert.equal(sets, 1, 'the unchanged file was not parsed again');
  assert.deepEqual(warm, cold);
  store.set(key, store.get(key).map((u) => ({ ...u, detail: 'from the cache' })));
  assert.ok(buildLogicMap(dir, ['src/total.ts'], { cache }).units.every((u) => u.detail === 'from the cache'));
  fs.writeFileSync(path.join(dir, 'src/total.ts'), SRC.replace('=== 0', '< 1'));
  const changed = buildLogicMap(dir, ['src/total.ts'], { cache });
  assert.equal(sets, 2, 'a changed file is parsed again');
  assert.ok(changed.units.some((u) => /< 1/.test(u.detail)));
  assert.deepEqual(buildLogicMap(dir, ['src/total.ts']), changed, 'with or without the cache, the same map');
});
