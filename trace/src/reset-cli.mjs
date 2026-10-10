#!/usr/bin/env node
// node src/reset-cli.mjs <examples-dir> [name] [--snapshot]
//   (no flag)   reset one example, or all of them: delete saved answers / AI decisions / AI cache, restore the original inputs
//   --snapshot  save a pristine copy of the inputs (.original/) for examples that don't have one yet
import fs from "node:fs";
import path from "node:path";
import { resetExample, snapshotExample } from "./reset.mjs";

const args = process.argv.slice(2);
const [root, only] = args.filter((a) => !a.startsWith("--"));
if (!root) { console.error("usage: node src/reset-cli.mjs <examples-dir> [name] [--snapshot]"); process.exit(1); }
const names = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "feature.json")) && (!only || d === only)).sort();
if (!names.length) { console.error(only ? `no example "${only}"` : "no examples found"); process.exit(1); }
for (const n of names) {
  const dir = path.join(root, n);
  if (args.includes("--snapshot")) { console.log(`${n.padEnd(12)} ${snapshotExample(dir) ? "saved .original/" : ".original/ already exists"}`); continue; }
  const r = resetExample(dir);
  console.log(`${n.padEnd(12)} removed ${r.removed.join(", ") || "nothing"} · restored ${r.restored.join(", ") || (r.hasOriginal ? "nothing (inputs already original)" : "nothing (no .original/ to restore from)")}`);
}
