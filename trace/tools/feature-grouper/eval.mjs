#!/usr/bin/env node
// feature-grouper eval: runs every fixture (fixtures/*.tsx with a <name>.expected.json) through `groupPage` for
// each embedder variant and prints expected vs found groups and a match rate.
//
// A found group matches an expected group when
//   exact: its member roots are exactly the expected member lines, or
//   fuzzy: the Jaccard overlap of the sets of JSX elements the two cover is >= 0.8.
// Matching is one-to-one (highest overlap first, ties by expected order). Rate = matched expected / expected.
// Precision = matched found / found groups (extra found groups are false positives).
//   node tools/feature-grouper/eval.mjs [--variant hashed|ollama] [--threshold N] [--sweep] [--quiet]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupPage } from "./grouper.mjs";
import { createEmbedder } from "./embed.mjs";
import { demoPages, ROOT } from "./group.mjs";
import { subtree } from "./describe.mjs";
import { subframePages, groupSubframePages, startSubframeServer, screenshotSubframePages, OUT_DIR } from "./subframe.mjs";

// Hand-written, one line each, from reading each page's group.mjs output and its screenshot (out/subframe/*.png)
// side by side -- see the report for how they were produced. There is no ground truth for these real pages, so
// this is an honest eyeball note, not a score.
const SUBFRAME_VERDICTS = {
  redesigned: "Top bar, side-nav sections and the 6-row category table all come out right; the page's 6 MetricCard "
    + "KPI tiles come out as three repeating groups (1+2+3, cosine similarity checked directly: card 1 is genuinely "
    + "~0.75 from the others, cards 2-3 and 4-6 are each ~0.99 within themselves) -- structurally correct, but a "
    + "person would likely still call all 6 one 'KPI row' feature, so this reads as three groups instead of one.",
  "figma-1": "Side nav, header bar and the 6-row Table.Row group are right. The signature fix (describe.mjs: exact "
    + "direct-child count + a depth-normalised branch-shape signature) stopped the previous false merge of the "
    + "'Number of savings initiatives' and 'Risk initiatives' panels (was cosine 0.869 at threshold 0.85, now "
    + "0.758, verified directly): those two are no longer grouped together as one repeating pair. Their smaller "
    + "header and progress-bar sub-blocks still correctly pair up as their own small repeating groups.",
  "figma-2": "Same shape as figma-1 (topbar, side-nav, 6-row table, 6-tile footer group). The 3-column stat panel: "
    + "column 1's unique 21-cell colour grid correctly stays its own group. But in the fully-merged tool the "
    + "thresholds fix's whole-two-column merge for this page does NOT fire: with signature's sharper description "
    + "(exact child count + branch-shape signature, needed to fix figma-1's false merge) in place, column 2 vs "
    + "column 3's whole-subtree cosine drops from 0.84 (thresholds fix alone) to 0.78 -- past the 0.03 "
    + "sibling-merge band -- so grouper.mjs's post-hoc sibling merge no longer treats them as a near miss. The "
    + "panel instead comes out as: one 3-way repeating group of all three columns' small header rows (overline "
    + "label + arrow icon, lines 245/288/319), a 2-way repeating group of column 2 and 3's progress-bar blocks "
    + "(lines 297,333), and column 1's caption plus column 3's value+caption folding into an unrelated, larger "
    + "scattered repeat with similarly-shaped captions elsewhere on the page -- correct content, still fragmented "
    + "by column, not the single whole-column group the thresholds fix produces on its own. This is a genuine, "
    + "unresolved interaction between the thresholds and signature fixes (each correct in isolation, pulling in "
    + "opposite directions here), not a bug in either fix by itself; flagged 2026-09-27, not patched.",
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Overlap needed for a fuzzy match. */
export const JACCARD_MIN = 0.8;

/**
 * The fixtures: every `fixtures/<name>.tsx` that has a `<name>.expected.json`, sorted by name.
 *
 * @returns {{name:string, file:string, source:string, expected:object}[]} Fixtures.
 */
export function loadFixtures() {
  const dir = path.join(HERE, "fixtures");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tsx")).sort().flatMap((f) => {
    const exp = path.join(dir, f.replace(/\.tsx$/, ".expected.json"));
    if (!fs.existsSync(exp)) return [];
    return [{ name: f, file: path.join(dir, f), source: fs.readFileSync(path.join(dir, f), "utf8"), expected: JSON.parse(fs.readFileSync(exp, "utf8")) }];
  });
}

const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter) || 0;
};

/**
 * Score one grouping result against a fixture's expected groups.
 *
 * @param {object} result The value returned by `groupPage` (with its non-enumerable `nodes`).
 * @param {{groups: {name:string, kind:string, members:number[]}[]}} expected The hand-written expectation.
 * @returns {{pairs: object[], matched:number, exact:number, fuzzy:number, expected:number, found:number, extras: object[]}}
 *   Per expected group the matched found group (or null) and how; extras are unmatched found groups.
 */
export function score(result, expected) {
  const nodes = result.nodes;
  const byLine = (line) => nodes.find((n) => n.line === line);
  const covered = (roots) => new Set(roots.flatMap((r) => (r ? subtree(r).map((n) => n.id) : [])));
  const exp = expected.groups.map((g) => ({ ...g, set: covered(g.members.map(byLine)) }));
  const found = result.groups.map((g) => ({ g, set: covered(g.members.map((m) => nodes.find((n) => n.id === m.id))) }));
  const cand = [];
  exp.forEach((e, i) => found.forEach((f, j) => {
    const exact = e.members.length === f.g.members.length && e.members.every((l) => f.g.members.some((m) => m.line === l));
    const j2 = jaccard(e.set, f.set);
    if (exact || j2 >= JACCARD_MIN) cand.push({ i, j, exact, j2 });
  }));
  cand.sort((a, b) => Number(b.exact) - Number(a.exact) || b.j2 - a.j2 || a.i - b.i || a.j - b.j);
  const usedE = new Set();
  const usedF = new Set();
  const pairs = exp.map((e) => ({ expected: e, found: null, how: "MISS", kindOk: null }));
  for (const c of cand) {
    if (usedE.has(c.i) || usedF.has(c.j)) continue;
    usedE.add(c.i);
    usedF.add(c.j);
    pairs[c.i] = { expected: exp[c.i], found: found[c.j].g, how: c.exact ? "exact" : `fuzzy J=${c.j2.toFixed(2)}`, kindOk: found[c.j].g.kind === exp[c.i].kind };
  }
  const exact = pairs.filter((p) => p.how === "exact").length;
  const matched = pairs.filter((p) => p.found).length;
  return { pairs, matched, exact, fuzzy: matched - exact, expected: exp.length, found: found.length, extras: found.filter((_, j) => !usedF.has(j)).map((f) => f.g) };
}

const memoEmbedder = (inner) => {
  const cache = new Map();
  return {
    name: inner.name,
    defaultThreshold: inner.defaultThreshold,
    async embed(descs) {
      const missing = descs.filter((d) => !cache.has(d.text));
      if (missing.length) {
        const vecs = await inner.embed(missing);
        missing.forEach((d, i) => cache.set(d.text, vecs[i]));
      }
      return descs.map((d) => cache.get(d.text));
    },
  };
};

async function runVariant(kind, fixtures, threshold, quiet) {
  const { embedder, notice } = await createEmbedder({ kind });
  if (notice) {
    console.log(`variant ${kind}: unavailable. ${notice}`);
    return null;
  }
  const memo = memoEmbedder(embedder);
  const rows = [];
  for (const f of fixtures) {
    const result = await groupPage(f.source, { file: f.name, embedderImpl: memo, threshold });
    const s = score(result, f.expected);
    rows.push({ f, result, s });
    if (!quiet) {
      console.log(`  ${f.name}: threshold ${result.threshold}, parser ${result.engine}`);
      for (const p of s.pairs) {
        const lines = p.expected.members.join(",");
        console.log(`    expected ${p.expected.kind.padEnd(9)} ${p.expected.name} (lines ${lines})  ->  ${p.found ? `${p.found.id} ${p.found.kind} lines ${p.found.members.map((m) => m.line).join(",")}  [${p.how}${p.kindOk ? "" : ", KIND DIFFERS"}]` : "MISS"}`);
      }
      for (const x of s.extras) console.log(`    extra found ${x.id} ${x.kind} lines ${x.members.map((m) => m.line).join(",")}  ${x.reason}`);
    }
  }
  return { embedder: embedder.name, rows, memo };
}

/**
 * Match rate over rows from `runVariant`.
 *
 * @param {{s: object}[]} rows Scored fixtures.
 * @returns {{matched:number, exact:number, kindOk:number, expected:number, found:number, foundMatched:number}} Totals.
 */
export function totals(rows) {
  const t = { matched: 0, exact: 0, kindOk: 0, expected: 0, found: 0, foundMatched: 0 };
  for (const { s } of rows) {
    t.matched += s.matched;
    t.exact += s.exact;
    t.kindOk += s.pairs.filter((p) => p.kindOk).length;
    t.expected += s.expected;
    t.found += s.found;
    t.foundMatched += s.matched;
  }
  return t;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const threshold = opt("--threshold") === undefined ? undefined : Number(opt("--threshold"));
  const only = opt("--variant");
  const quiet = args.includes("--quiet");
  const fixtures = loadFixtures();
  const variants = only ? [only] : ["hashed", "ollama"];
  const summary = [];
  for (const kind of variants) {
    console.log(`== variant: ${kind}`);
    const run = await runVariant(kind, fixtures, threshold, quiet);
    if (!run) continue;
    const t = totals(run.rows);
    for (const { f, s } of run.rows) console.log(`  ${f.name.padEnd(16)} matched ${s.matched}/${s.expected} (exact ${s.exact}), found ${s.found}, extra ${s.extras.length}`);
    console.log(`  overall: matched ${t.matched}/${t.expected} = ${pct(t.matched, t.expected)} (exact ${t.exact}, kind also right ${t.kindOk}); precision ${t.foundMatched}/${t.found} = ${pct(t.foundMatched, t.found)}\n`);
    summary.push({ kind: `${kind} (${run.embedder}, threshold ${run.rows[0].result.threshold})`, t });
    if (args.includes("--sweep")) {
      for (let th = 0.6; th <= 0.991; th += 0.05) {
        const r = [];
        for (const f of fixtures) r.push({ s: score(await groupPage(f.source, { file: f.name, embedderImpl: run.memo, threshold: th }), f.expected) });
        const tt = totals(r);
        console.log(`  sweep ${kind} threshold ${th.toFixed(2)}: matched ${tt.matched}/${tt.expected} = ${pct(tt.matched, tt.expected)}, precision ${pct(tt.foundMatched, tt.found)}`);
      }
      console.log("");
    }
  }
  console.log("== side by side (match = a found group equals the expected member set, or Jaccard >= 0.8 on covered elements)");
  for (const s of summary) console.log(`  ${s.kind.padEnd(58)} match rate ${s.t.matched}/${s.t.expected} = ${pct(s.t.matched, s.t.expected)} (exact ${s.t.exact}, kind also right ${s.t.kindOk}), precision ${pct(s.t.foundMatched, s.t.found)}`);

  console.log("\n== smoke: demo-app pages (no expected groups; group counts only)");
  const pages = demoPages();
  const fx = (await createEmbedder({ kind: "hashed" })).embedder;
  for (const p of pages) {
    const r = await groupPage(fs.readFileSync(p, "utf8"), { file: path.relative(ROOT, p), embedderImpl: fx });
    console.log(`  ${r.file}: ${r.totals.groups} groups (${r.groups.map((g) => g.kind[0] + ":" + g.members[0].tag).join(" ")}), ${r.totals.ungrouped}/${r.totals.elements} elements ungrouped`);
  }
}

/**
 * Audit feature-grouper against the subframe-app pages: group each page's source, then render its route in a
 * real browser and screenshot it. No hand labels exist for these pages (unlike the fixtures above), so this
 * checks smoke (does it render, no console errors) and prints an honest eyeball verdict, not a match rate.
 *
 * @returns {Promise<{route:string, label:string, elements:number, kinds:string, renderOk:boolean, screenshot:string,
 *   verdict:string}[]>} One row per page, also printed as a table.
 */
export async function runSubframeAudit() {
  const { chromium } = await import("playwright");
  const grouped = await groupSubframePages();
  console.log(`== subframe-app pages: ${subframePages().map((p) => p.route).join(", ")}`);
  console.log("(no hand labels for these real pages -- smoke + eyeball sanity check, not an accuracy score)\n");
  let server;
  let shots;
  try {
    server = await startSubframeServer();
    const browser = await chromium.launch();
    try {
      shots = await screenshotSubframePages(server.base, browser);
    } finally {
      await browser.close();
    }
  } finally {
    server?.proc.kill();
  }
  const rows = grouped.map((g) => {
    const shot = shots.find((s) => s.route === g.route);
    const kinds = g.result.groups.map((x) => `${x.kind === "repeating" ? "r" : "u"}:${x.memberCount}`).join(" ");
    return {
      route: g.route, label: g.label, elements: g.result.totals.elements, groups: g.result.totals.groups, kinds,
      renderOk: shot?.ok ?? false, errors: shot?.errors ?? ["(no screenshot)"], screenshot: shot?.screenshot ?? null,
      verdict: SUBFRAME_VERDICTS[g.route] ?? "(no eyeball note recorded for this page)",
    };
  });
  console.log("page       elements groups  render  kinds (r=repeating u=unique, :member-count)");
  for (const r of rows) console.log(`${r.route.padEnd(11)}${String(r.elements).padEnd(9)}${String(r.groups).padEnd(8)}${(r.renderOk ? "ok" : "FAIL").padEnd(8)}${r.kinds}`);
  console.log(`\nscreenshots: ${OUT_DIR}`);
  console.log("\nverdicts (eyeballed against the screenshot and the group listing, no ground truth):");
  for (const r of rows) console.log(`  ${r.route} (${r.label}): ${r.verdict}`);
  const failed = rows.filter((r) => !r.renderOk);
  if (failed.length) console.log(`\nRENDER ERRORS: ${failed.map((r) => `${r.route}: ${r.errors.join("; ")}`).join(" | ")}`);
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--subframe")) await runSubframeAudit();
  else await main();
}
