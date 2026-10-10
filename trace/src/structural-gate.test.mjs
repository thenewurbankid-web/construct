// The structural gate: flags a coincidence, asks (confirm-or-pick) unless the design's words vouch for it, and stays
// off (nothing recorded, nothing asked) when the flag is not on. Also the end-to-end runs: pipeline, hints, CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extract } from "./extract.mjs";
import { match } from "./match.mjs";
import { snapshotTies } from "./infer.mjs";
import { buildQuestions, resolveQuestions } from "./ask.mjs";
import { computeHints, openItems } from "./hints.mjs";
import { applyStructural, structuralContext, structuralRows } from "./structural-gate.mjs";
import { runPipeline } from "./pipeline.mjs";
import { apisToOpenApi } from "./apis-to-openapi.mjs";
import { readSpec } from "./contract.mjs";
import { buildTree } from "./tree/model.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-structural-"));

// A small screen with every pattern: a rank column that is the id, a count that is the row count, an overall max.
const orders = [
  { id: 1, name: "Fjord", balance: 7470000, stock: 130 },
  { id: 2, name: "Tundra", balance: 2500000, stock: 148 },
  { id: 3, name: "Cedar", balance: 4110000, stock: 126 },
  { id: 4, name: "Kestrel", balance: 4980000, stock: 129 },
];
const apis = [
  { method: "GET", path: "/api/orders", response: orders },
  { method: "POST", path: "/api/orders", request: { name: "new" }, response: orders[0] },
];
const row = (o, i) => `<tr><td data-dyn="rank">${i + 1}</td><td data-dyn="name">${o.name}</td><td data-dyn="stock">${o.stock}</td></tr>`;
const page = `export default function P() { return (<main>
  <p>{" items "}<span data-dyn="itemCount">4</span>{" open "}<span data-dyn="openCount">4</span>{" largest open "}<span data-dyn="topOpen">$7.5M</span></p>
  <table><thead><tr><th>Rank</th><th>Name</th><th>Stock</th></tr></thead><tbody data-list="orders">${orders.map(row).join("")}</tbody></table>
</main>); }`;
const spec = { feature: "orders", route: "/orders", page: "page.jsx", apis };

function screen(flag = true) {
  const m = match(extract(page), spec);
  snapshotTies(m);
  if (flag) applyStructural(m, structuralContext(page, spec));
  return m;
}
const part = (m, id) => [...m.list.fields.map((f) => ["list." + f.name, f]), ...m.values.map((v) => ["value." + v.name, v])].find(([k]) => k === id)[1];

test("flag off: nothing is recorded and nothing new is asked", () => {
  const m = screen(false);
  for (const p of [...m.list.fields, ...m.values]) assert.equal(p.structural, undefined);
  assert.deepEqual(buildQuestions(m).map((q) => q.id), ["value.topOpen", "value.openCount"].filter((id) => buildQuestions(m).some((q) => q.id === id)), "only what the matcher itself could not settle");
  assert.deepEqual(structuralRows(m), []);
});

test("flag on: the count the design's words vouch for is accepted and the evidence is recorded; the qualified ones are asked", () => {
  const m = screen();
  const item = part(m, "value.itemCount").structural;
  assert.deepEqual([item.decision, item.pattern, item.evidence.verdict], ["accepted", "count-equals-row-count", "supports"]);
  const open = part(m, "value.openCount").structural;
  assert.deepEqual([open.decision, open.pattern, open.evidence.verdict], ["asked", "count-equals-row-count", "neutral"]);
  assert.deepEqual(open.evidence.unmatched, ["open"]);
  assert.equal(part(m, "value.topOpen").structural.decision, "asked");
  const rank = part(m, "list.rank").structural;
  assert.deepEqual([rank.decision, rank.pattern, rank.evidence.verdict], ["asked", "sequence-equals-id-or-index", "contradicts"]);
  assert.equal(part(m, "list.name").structural, undefined, "an ordinary match is untouched");
  assert.equal(part(m, "list.stock").structural, undefined);
  assert.deepEqual(structuralRows(m).map((r) => `${r.part}:${r.decision}`), ["list.rank:asked", "value.itemCount:accepted", "value.openCount:asked", "value.topOpen:asked"]);
});

test("the asked ones become confirm-or-pick questions: A confirm, B ranked others, C a gap, then static and something else", () => {
  const m = screen();
  const qs = buildQuestions(m);
  assert.deepEqual(qs.map((q) => q.id), ["list.rank", "value.openCount", "value.topOpen"], "the accepted count is not asked");
  const q = qs.find((x) => x.id === "value.topOpen");
  assert.equal(q.form, "confirm-or-pick");
  assert.equal(q.type, "choice");
  assert.match(q.text, /^"topOpen" \(shows "\$7\.5M"\) matched max\(balance\) of the list, shown as moneyCompact, but that could be a coincidence: the design's value is the largest "balance" of ALL 4 mock rows \(row 1\)/);
  assert.match(q.text, /The design shows "\$7\.5M"\. Confirm it, pick another explanation, or leave it as a gap\?$/);
  const labels = q.options.map((o) => o.label);
  assert.equal(labels[0], "Confirm: max(balance) of the list, shown as moneyCompact");
  assert.equal(labels.at(-3), "Leave it as a gap — a TODO to answer later");
  assert.equal(labels.at(-2), "static text — not data");
  assert.match(labels.at(-1), /^something else/);
  assert.ok(labels.slice(1, -3).every((l) => l.startsWith("Pick instead: ")));
  const rank = qs.find((x) => x.id === "list.rank");
  assert.equal(rank.options[0].label, 'Confirm: API field "id"');
  assert.match(rank.text, /^Row part "rank" \(e\.g\. "1"\) matched API field "id", but that could be a coincidence: the design shows a running number \(1, 2, 3, 4\)/);
  assert.match(rank.text, /none of the design's words \("rank"\) appear in the field name/);
});

test("answers: confirm keeps the candidate, a gap leaves a TODO, a saved answer is honoured; the question closes", async () => {
  const m = screen();
  const qs = buildQuestions(m);
  const { answers } = await resolveQuestions(qs, { answers: { "value.openCount": qs.find((q) => q.id === "value.openCount").options[0].value }, auto: true });
  assert.deepEqual(part(m, "value.openCount").candidates.map((c) => c.agg), ["count"], "saved confirm applied");
  assert.equal(part(m, "value.openCount").pendingConfirm, undefined);
  assert.deepEqual(Object.keys(answers), ["value.openCount"]);
  assert.equal(part(m, "list.rank").candidates[0].todo, true, "auto mode never guesses: still open");
  assert.equal(part(m, "list.rank").candidates[0].skipped, true);
});

test("auto mode: the part stays OPEN with the reason in the hint, and hints know it (never guessed)", async () => {
  const m = screen();
  const hints = computeHints(m);
  const h = hints.get("value.openCount");
  assert.equal(h.kind, "coincidence");
  assert.match(h.why, /One explanation reproduces "4" for "openCount", but it may be a coincidence: the design shows "4", which is exactly how many rows the mock list has \(4\)/);
  assert.match(h.hint, /^Confirm it if the design counts every row\./);
  assert.equal(hints.get("value.itemCount"), undefined, "an accepted flag is not an open item");
  const qs = buildQuestions(m);
  await resolveQuestions(qs, { auto: true });
  const open = openItems(m, hints);
  assert.deepEqual(open.filter((o) => !o.id.startsWith("form.")).map((o) => [o.id, o.state, o.origin]), [["list.rank", "skipped", "coincidence"], ["value.openCount", "skipped", "coincidence"], ["value.topOpen", "skipped", "coincidence"]]);
});

test("the tree shows a pending confirmation as a question, not as connected", () => {
  const m = screen();
  buildQuestions(m);
  const tree = buildTree(m, spec);
  const leaf = tree.groups.flatMap((g) => g.leaves).find((l) => l.id === "value.openCount");
  assert.match(JSON.stringify(leaf), /could be a coincidence/);
});

test("the gate is deterministic and does not depend on the order of the input", () => {
  const a = structuralRows(screen()), b = structuralRows(screen());
  assert.deepEqual(a, b);
  const shuffled = { ...spec, apis: [...apis].reverse() };
  const m = match(extract(page), shuffled);
  applyStructural(m, structuralContext(page, shuffled));
  assert.deepEqual(structuralRows(m), a);
});

// ---------- end to end ----------
function feature(dir, { pageSrc = page, contractApis = apis } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify({ feature: "orders", route: "/orders", page: "page.jsx" }));
  fs.writeFileSync(path.join(dir, "page.jsx"), pageSrc);
  fs.writeFileSync(path.join(dir, "openapi.json"), JSON.stringify(apisToOpenApi(contractApis, { title: "orders" })));
  return dir;
}
const walk = (d, base = d, out = {}) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out[path.relative(base, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  }
  return out;
};

test("pipeline: flag off writes what it always wrote (no structural key, no section); flag on records the flags in status.json and the report", async () => {
  const off = tmp(), on = tmp();
  await runPipeline({ dir: feature(path.join(tmp(), "orders")), outRoot: off, auto: true });
  await runPipeline({ dir: feature(path.join(tmp(), "orders")), outRoot: on, auto: true, structural: true });
  const st = (o) => JSON.parse(fs.readFileSync(path.join(o, "features/orders/status.json"), "utf8"));
  assert.equal("structural" in st(off), false);
  assert.doesNotMatch(fs.readFileSync(path.join(off, "features/orders/REPORT.md"), "utf8"), /Structural flags/);
  const s = st(on);
  assert.deepEqual(s.structural.map((r) => `${r.part}:${r.decision}`), ["list.rank:asked", "value.itemCount:accepted", "value.openCount:asked", "value.topOpen:asked"]);
  assert.deepEqual(s.structural.find((r) => r.part === "value.itemCount").evidence.matched, ["count"]);
  assert.ok(s.items.some((i) => i.id === "value.openCount" && i.state === "skipped" && i.origin === "coincidence" && /coincidence/.test(i.why)));
  const report = fs.readFileSync(path.join(on, "features/orders/REPORT.md"), "utf8");
  assert.match(report, /## Structural flags/);
  assert.match(report, /\| value\.openCount \| count-equals-row-count \| asked \| neutral \(open, count\) \|/);
  assert.notEqual(walk(off)["features/orders/domain/orders.domain.js"], walk(on)["features/orders/domain/orders.domain.js"], "the asked parts are not wired");
});

test("pipeline: the same run twice writes identical bytes with the flag on", async () => {
  const a = tmp(), b = tmp();
  await runPipeline({ dir: feature(path.join(tmp(), "orders")), outRoot: a, auto: true, structural: true });
  await runPipeline({ dir: feature(path.join(tmp(), "orders")), outRoot: b, auto: true, structural: true });
  assert.deepEqual(walk(a), walk(b));
});

test("flag off (false or absent) is byte-identical to the recorded output for all 11 examples", async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(root, "src", "fixtures", "pre-migration-output.json"), "utf8"));
  const examples = path.join(root, "examples");
  // products-no-contract, portfolio-figma-1-real (TR-23), the LIN-194 real-render siblings, products-history
  // (LIN-211), orgs-items (LIN-223) and orgs-items-reviews (LIN-250/TR-49) postdate this golden set, same as
  // contract.test.mjs.
  const names = fs
    .readdirSync(examples)
    .filter((d) => fs.existsSync(path.join(examples, d, "feature.json")) && !["products-no-contract", "portfolio-figma-1-real", "portfolio-figma-2-real", "portfolio-redesigned-real", "products-history", "orgs-items", "orgs-items-reviews"].includes(d));
  assert.equal(names.length, 11);
  const out = tmp();
  for (const [i, name] of names.entries()) {
    const dir = path.join(tmp(), name);
    fs.cpSync(path.join(examples, name), dir, { recursive: true });
    await runPipeline({ dir, outRoot: out, auto: true, ...(i % 2 ? { structural: false } : {}) });
  }
  const now = walk(out);
  assert.deepEqual(Object.keys(golden).filter((f) => now[f] !== golden[f]), []);
  assert.deepEqual(Object.keys(now).filter((f) => !(f in golden)), []);
});

test("flag on runs every example; the files of an example with no asked flag equal the flag-off files apart from the report", async () => {
  const examples = path.join(root, "examples");
  const names = fs.readdirSync(examples).filter((d) => fs.existsSync(path.join(examples, d, "feature.json")) && d !== "products-no-contract");
  const off = tmp(), on = tmp();
  for (const name of names) {
    for (const [out, structural] of [[off, false], [on, true]]) {
      const dir = path.join(tmp(), name);
      fs.cpSync(path.join(examples, name), dir, { recursive: true });
      await runPipeline({ dir, outRoot: out, auto: true, structural });
    }
  }
  const a = walk(off), b = walk(on);
  const asked = new Set();
  for (const f of Object.keys(b).filter((f) => f.endsWith("/status.json"))) {
    const s = JSON.parse(fs.readFileSync(path.join(on, f), "utf8"));
    if (s.structural.some((r) => r.decision === "asked")) asked.add(f.split("/")[1]);
  }
  // metrics/regionCount used to land here before LIN-213's implicitSubject fix (R6.53): the page's own
  // "4 regions" text now supports the match, so it is accepted, not asked. portfolio-redesigned/coveredCount
  // has no such nearby subject word, so it still exercises the asked path this test is checking.
  assert.ok(asked.has("portfolio-redesigned"), "portfolio-redesigned's coveredCount is asked (no design words name its row subject)");
  for (const f of Object.keys(a)) {
    const feature = f.split("/")[1];
    if (asked.has(feature) || /(REPORT\.(md|html)|status\.json)$/.test(f)) continue;
    assert.equal(b[f], a[f], f);
  }
});

test("CLI: --structural asks about the coincidences and lists them; without it nothing changes", () => {
  const dir = feature(path.join(tmp(), "orders"));
  const run = (...flags) => spawnSync("node", [path.join(root, "src/cli.mjs"), dir, "--auto", "--out", tmp(), ...flags], { encoding: "utf8" });
  const on = run("--structural");
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /value\.openCount|openCount \[skipped\]/);
  assert.match(on.stdout, /may be a coincidence/);
  const off = run();
  assert.equal(off.status, 0, off.stderr);
  assert.doesNotMatch(off.stdout, /coincidence/);
});

test("no server route and no UI file mentions the gate", () => {
  for (const f of ["src/server.mjs", "src/http-guard.mjs", "src/contract-routes.mjs", "src/build-routes.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /structural/i, f);
  }
});

test("a contract with field docs lets the docs vouch for a cryptic field; readSpec carries them", () => {
  const dir = tmp();
  const doc = apisToOpenApi([{ method: "GET", path: "/api/orders", response: [{ id: 1, c_amt: 7 }, { id: 2, c_amt: 9 }] }], { title: "o" });
  doc.paths["/api/orders"].get.responses[200].content["application/json"].schema.items.properties.c_amt.description = "Total spend for the year.";
  fs.writeFileSync(path.join(dir, "openapi.json"), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, "feature.json"), JSON.stringify({ feature: "orders", page: "page.jsx" }));
  assert.deepEqual(readSpec(dir).contract.fieldDocs, { c_amt: { description: "Total spend for the year." } });
});
