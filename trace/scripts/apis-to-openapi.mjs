#!/usr/bin/env node
// Migrates a hand-written contract (`apis` in feature.json) to an OpenAPI file in the same folder.
//
//   node scripts/apis-to-openapi.mjs <example-dir> [--from feature.json] [--to openapi.json] [--delete-source]
//   node scripts/apis-to-openapi.mjs --all <examples-dir>
//
// Writes <to> (OpenAPI 3.0: `:id` -> `{id}`, bodies as `example` + an inferred schema), checks that reading it back
// gives the same `apis`, then removes `apis` from feature.json. `list` stays in feature.json only when the contract
// alone would not find the same list key (an envelope with several arrays). A pristine copy in .original/ is refreshed
// so "Reset" restores the migrated inputs. With --from/--to for a side file (feature.fixed.json), the source is
// deleted with --delete-source.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { apisToOpenApi } from "../src/apis-to-openapi.mjs";
import { readOpenApi } from "../src/openapi.mjs";

const canon = (apis) => [...apis].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));

export function migrate(dir, { from = "feature.json", to = "openapi.json", deleteSource = false } = {}) {
  const src = path.join(dir, from);
  const spec = JSON.parse(fs.readFileSync(src, "utf8"));
  if (!Array.isArray(spec.apis)) return { dir, skipped: "no apis in " + from };
  const doc = apisToOpenApi(spec.apis, { title: spec.feature ?? path.basename(dir) });
  const text = JSON.stringify(doc, null, 2) + "\n";
  // The migration must lose nothing: the file read back is the same contract.
  const back = readOpenApi(text, { listKey: spec.list ?? null });
  assert.deepEqual(canon(back.apis), canon(spec.apis), `${dir}: the OpenAPI file does not read back as the same apis`);
  assert.equal(back.gaps.length, 0, `${dir}: the migrated file has gaps`);
  const derived = readOpenApi(text).listKey;
  fs.writeFileSync(path.join(dir, to), text);

  const keepList = !!spec.list && spec.list !== derived;
  const { apis: _apis, ...next } = spec; // keeps the key order of the file
  if (!keepList) delete next.list;
  if (deleteSource) fs.rmSync(src);
  else fs.writeFileSync(src, JSON.stringify(next, null, 2) + "\n");

  // .original/ holds the pristine inputs for "Reset": bring it in line
  const orig = path.join(dir, ".original");
  if (!deleteSource && fs.existsSync(orig)) {
    fs.copyFileSync(src, path.join(orig, "feature.json"));
    fs.copyFileSync(path.join(dir, to), path.join(orig, to));
  }
  return { dir, wrote: to, endpoints: spec.apis.length, listKey: derived, keptList: keepList };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const values = new Set([opt("--from"), opt("--to")].filter(Boolean));
  const pos = args.filter((a) => !a.startsWith("--") && !values.has(a));
  if (!pos.length) { console.error("usage: node scripts/apis-to-openapi.mjs <example-dir> [--from f] [--to f] [--delete-source] | --all <examples-dir>"); process.exit(1); }
  const dirs = args.includes("--all")
    ? fs.readdirSync(pos[0]).map((d) => path.join(pos[0], d)).filter((d) => fs.existsSync(path.join(d, "feature.json"))).sort()
    : [pos[0]];
  for (const d of dirs) {
    const r = migrate(d, { from: opt("--from"), to: opt("--to"), deleteSource: args.includes("--delete-source") });
    console.log(r.skipped ? `${path.basename(d).padEnd(20)} skipped (${r.skipped})` : `${path.basename(d).padEnd(20)} -> ${r.wrote} (${r.endpoints} endpoints${r.listKey ? `, list key "${r.listKey}" found in the contract` : ""}${r.keptList ? ', "list" kept in feature.json' : ""})`);
  }
}
