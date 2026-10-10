#!/usr/bin/env node
// feature-grouper CLI: group a TSX/JSX page's elements into candidate feature components.
//   node tools/feature-grouper/group.mjs <page.tsx> [--threshold N] [--min-size N] [--embedder hashed|ollama] [--json]
//   pbpaste | node tools/feature-grouper/group.mjs -        (a lone "-" reads the page from stdin)
//   node tools/feature-grouper/group.mjs --demo              (every demo-app page)
// Exit codes: 0 ok, 1 usage error, 2 a page could not be read or parsed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupPage, PageParseError, DEFAULT_MIN_SIZE } from "./grouper.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The line-matcher root (two levels above this file). */
export const ROOT = path.resolve(HERE, "..", "..");

/**
 * The demo-app pages (`demo-app/src/features/<feature>/page/*.jsx|tsx`), sorted, as absolute paths.
 *
 * @returns {string[]} Page files.
 */
export function demoPages() {
  const features = path.join(ROOT, "demo-app", "src", "features");
  if (!fs.existsSync(features)) return [];
  return fs.readdirSync(features).sort().flatMap((f) => {
    const dir = path.join(features, f, "page");
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.(tsx|jsx)$/.test(n)).sort().map((n) => path.join(dir, n)) : [];
  });
}

/**
 * Render a grouping result as human-readable text (deterministic).
 *
 * @param {object} result The value returned by `groupPage`.
 * @returns {string} Lines to print.
 */
export function formatResult(result) {
  const t = result.totals;
  const out = [
    `${result.file}  [parser=${result.engine} embedder=${result.embedder} threshold=${result.threshold}]`,
    `  ${t.elements} elements, ${t.candidates} candidate subtrees, ${t.groups} groups covering ${t.grouped} elements (${t.ungrouped} ungrouped)`,
  ];
  if (result.notice) out.push(`  note: ${result.notice}`);
  for (const g of result.groups) {
    const where = g.lines.from === g.lines.to ? `line ${g.lines.from}` : `lines ${g.lines.from}-${g.lines.to}`;
    out.push(`  ${g.id}  ${g.kind.padEnd(9)} ${g.component ?? "(module scope)"}  ${where}  ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}, ${g.elements} elements`);
    out.push(`      ${g.reason}`);
  }
  if (!result.groups.length) out.push("  (no groups)");
  return out.join("\n");
}

function parseArgs(argv) {
  const opts = { files: [], json: false, demo: false, threshold: undefined, minSize: DEFAULT_MIN_SIZE, embedder: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = (name) => {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v)) throw new Error(`${name} needs a number`);
      return v;
    };
    if (a === "--json") opts.json = true;
    else if (a === "--demo") opts.demo = true;
    else if (a === "--threshold") opts.threshold = num(a);
    else if (a === "--min-size") opts.minSize = num(a);
    else if (a === "--embedder") opts.embedder = argv[++i];
    else if (a === "-" || !a.startsWith("--")) opts.files.push(a);
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`feature-grouper: ${e.message}`);
    process.exit(1);
  }
  const inputs = opts.demo ? demoPages() : opts.files;
  if (!inputs.length) {
    console.error("usage: group.mjs <page.tsx|-> [--threshold N] [--min-size N] [--embedder hashed|ollama] [--json]   |   group.mjs --demo");
    process.exit(1);
  }
  const results = [];
  let failed = false;
  for (const input of inputs) {
    let source;
    let name;
    try {
      if (input === "-") {
        source = await readStdin();
        name = "<stdin>";
      } else {
        source = fs.readFileSync(input, "utf8");
        name = opts.demo ? path.relative(ROOT, input) : input;
      }
      results.push(await groupPage(source, { file: name, threshold: opts.threshold, minSize: opts.minSize, embedder: opts.embedder }));
    } catch (e) {
      failed = true;
      console.error(`feature-grouper: ${e instanceof PageParseError ? e.message : `cannot read ${input}: ${e.message}`}`);
    }
  }
  if (opts.json) console.log(JSON.stringify(results.length === 1 && !opts.demo ? results[0] : results, null, 2));
  else for (const r of results) console.log(`${formatResult(r)}\n`);
  if (failed) process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
