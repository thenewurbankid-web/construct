#!/usr/bin/env node
// Builds the bench shop's logic map with Line's own logic-map block (engine buildLogicMap) and stores it as JSONL next
// to this script, so the atom metric is reproducible without the bench run folder (bench/ecommerce/runs/ is not in git).
//
//   node packages/line-atoms/metric/build-shop-map.mjs <bench-project-dir>
//
// <bench-project-dir>: a finished bench/ecommerce build, e.g. bench/ecommerce/runs/pilot-haiku/project on branch
// bench-ecom (the Haiku pilot, 22/22 acceptance). Every .ts/.tsx under app/, features/ and library/ is mapped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { write } from '@line/construct-core/fs';
import { buildLogicMap } from '@line/construct-engine/line/logic-map';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bench-shop-logicmap.jsonl');

/**
 * The app-root-relative code files of a bench build.
 * @param {string} root
 * @returns {string[]}
 */
export function shopFiles(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(r);
      else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(r);
    }
  };
  for (const top of ['app', 'features', 'library']) if (fs.existsSync(path.join(root, top))) walk(top);
  return out.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node packages/line-atoms/metric/build-shop-map.mjs <bench-project-dir>');
    process.exit(2);
  }
  const map = buildLogicMap(path.resolve(root), shopFiles(path.resolve(root)));
  const lines = map.units.map(({ id, file, fn, kind, line, detail }) => JSON.stringify({ id, file, fn, kind, line, detail }));
  process.stdout.write(`${map.units.length} units from ${map.files.length} files\n`);
  write(OUT, `${lines.join('\n')}\n`);
}
