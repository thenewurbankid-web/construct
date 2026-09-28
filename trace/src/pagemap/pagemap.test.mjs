// The Page map's engine: inventory, collapse, classification, apply, decisions and the service. Offline, no model, no clock
// (the history's `at` is injected). Fixtures: the three real Subframe pages copied in src/import/fixtures, and the examples.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, verbOf, textInNode } from "./inventory.mjs";
import { collapse, visibleIds } from "./collapse.mjs";
import { classify, effectiveOf, coverage, rootOf } from "./classify.mjs";
import { contractMatcher } from "./contract-match.mjs";
import { applyDecisions, editsFor, effectiveAll, diffOf } from "./apply.mjs";
import { wireframe } from "./preview.mjs";
import { setDecisions, undo, redo, readDecisions, readHistory, summary } from "./store.mjs";
import * as svc from "./service.mjs";
import { applyMarkers, suggestMarkers, parsePage, extractParts } from "../import/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const fx = (f) => fs.readFileSync(path.join(root, "src", "import", "fixtures", f), "utf8");
const page = (jsx) => `export default function P() {\n  return (\n${jsx}\n  );\n}\n`;
const analyseSrc = (source, opts = {}) => {
  const inv = buildInventory(source, { file: "t.jsx" });
  const cx = collapse(inv);
  const { proposals, issues, follow } = classify(inv, cx, source, opts);
  return { inv, cx, proposals, issues, follow, source };
};
const textNode = (a, text) => a.inv.nodes.find((n) => n.kind === "text" && n.text === text);
const tmpExamples = (names = ["orders", "portfolio-figma-1"]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-pagemap-"));
  for (const name of names) {
    fs.mkdirSync(path.join(dir, "examples", name), { recursive: true });
    for (const f of ["feature.json", "openapi.json", "page.jsx"]) fs.copyFileSync(path.join(root, "examples", name, f), path.join(dir, "examples", name, f));
  }
  fs.mkdirSync(path.join(dir, "subframe-app", "src", "pages"), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, "subframe-app", "src", "pages")).filter((x) => /\.tsx$/.test(x))) fs.copyFileSync(path.join(root, "subframe-app", "src", "pages", f), path.join(dir, "subframe-app", "src", "pages", f));
  return { dir, env: { examplesDir: path.join(dir, "examples"), pagesDir: path.join(dir, "subframe-app", "src", "pages") } };
};

// ---------- inventory ----------
test("inventory: every element and text node, including {\"x\"}, template literals and attribute text (a11y flagged)", () => {
  const inv = buildInventory(page(`    <div>\n      <p>Hello {"there"} {\`plain\`} {count}</p>\n      <img alt="A logo" src="x.png" />\n      <input placeholder="Your name" name="n" required />\n    </div>`), { file: "t.jsx" });
  const texts = inv.nodes.filter((n) => n.kind === "text");
  assert.deepEqual(texts.map((t) => [t.text, t.textKind]), [["Hello", "jsx"], ["there", "literal"], ["plain", "template"], ["count", "expression"], ["A logo", "attribute"], ["Your name", "attribute"]]);
  assert.equal(texts.find((t) => t.text === "A logo").a11y, true);
  assert.equal(texts.find((t) => t.text === "Your name").attr, "placeholder");
  const input = inv.nodes.find((n) => n.tag === "input");
  assert.equal(input.kind, "input");
  assert.deepEqual([input.details.name, input.details.placeholder, input.details.required, input.details.inputType], ["n", "Your name", true, "text"]);
  assert.equal(inv.nodes.find((n) => n.tag === "img").kind, "media");
});

test("inventory: ids are stable (same source, same ids) and unique; they depend on the file name and the position", () => {
  const a = buildInventory(fx("figma-1.tsx"), { file: "a.tsx" }), b = buildInventory(fx("figma-1.tsx"), { file: "a.tsx" }), c = buildInventory(fx("figma-1.tsx"), { file: "c.tsx" });
  assert.deepEqual(a.nodes.map((n) => n.id), b.nodes.map((n) => n.id));
  assert.equal(new Set(a.nodes.map((n) => n.id)).size, a.nodes.length);
  assert.notEqual(a.nodes[5].id, c.nodes[5].id);
  assert.ok(a.nodes.every((n) => n.id === "root" || /^n[0-9a-f]{8,}$/.test(n.id)));
});

test("inventory: kinds for interactions, tables, cells, lists and a slot; handlers and the verb come from the label", () => {
  const inv = buildInventory(fx("figma-1.tsx"), { file: "f.tsx" });
  const kinds = inv.counts;
  for (const k of ["text", "interaction", "table", "row", "cell", "media", "visual", "container", "list"]) assert.ok(kinds[k] > 0, k);
  const btn = inv.nodes.find((n) => n.kind === "interaction" && n.tag === "Button");
  assert.ok(btn.details.handlers.includes("onClick"));
  assert.equal(verbOf("Save changes"), "save");
  assert.equal(verbOf("Add customer"), "create");
  assert.equal(verbOf("Prompt suggestion 01"), "promptSuggestion01");
  const nav = inv.nodes.find((n) => n.tag === "SideNav");
  assert.ok(inv.nodes.some((n) => n.parent === nav.id && n.slot === "mainMenu"), "elements in a prop keep the prop as their slot");
});

test("inventory: a table's columns map header text to the cells below (header -> examples)", () => {
  const inv = buildInventory(fs.readFileSync(path.join(root, "examples", "orders", "page.jsx"), "utf8"), { file: "p.jsx" });
  const table = inv.nodes.find((n) => n.kind === "table");
  assert.deepEqual(table.details.columns.map((c) => c.header), ["Order", "Customer", "Total", "Placed", "Status", ""]);
  assert.deepEqual(table.details.columns[1].examples, ["Northwind", "Kestrel", "Bluepeak"]);
  assert.equal(table.details.rowCount, 3);
});

test("inventory: a .map() row is a group of one whose count is unknown", () => {
  const a = analyseSrc(page(`    <ul>\n      {items.map((i) => <li key={i.id}>{i.name}</li>)}\n    </ul>`));
  const g = a.cx.groups[0];
  assert.equal(g.mapped, true);
  assert.equal(g.count, null);
  assert.equal(a.inv.byId.get(g.parent).kind, "list");
  assert.equal(textNode(a, "i.name").textKind, "expression");
});

test("inventory: a syntax error is the parser's error, not a crash of something else", () => {
  assert.throws(() => buildInventory("export default () => <div>", { file: "x.jsx" }), /Unexpected|Unterminated|expected/i);
});

// ---------- collapse ----------
test("collapse: repeated sibling structures become one template with xN and the values that vary; reversible", () => {
  const src = fx("figma-1.tsx");
  const inv = buildInventory(src, { file: "f.tsx" });
  const cx = collapse(inv);
  const table = cx.groups.find((g) => inv.byId.get(g.parent).kind === "table");
  assert.equal(table.count, 6, "all six data rows, though their shapes differ, are one group");
  assert.ok(table.slots.some((s) => s.varies && s.examples.includes("Logistics") && s.examples.includes("Packaging")));
  assert.ok(cx.stats.visible < cx.stats.total, "fewer nodes are shown than exist");
  const all = visibleIds(inv, cx, "all");
  assert.deepEqual([...all].sort(), inv.nodes.slice(1).map((n) => n.id).sort(), "expanding every group shows every node once");
  assert.equal(new Set(all).size, all.length);
  // instances map to the template, so one decision covers them
  const inst = inv.byId.get(table.members[3]);
  assert.equal(cx.templateOf[inst.id], table.template, "the alignment pairs an instance row with the template row");
  const a1 = analyseSrc(src);
  const tg = a1.cx.groups.find((g) => a1.inv.byId.get(g.parent).kind === "table");
  assert.equal(rootOf(a1.follow, tg.members[3]), tg.template, "the rows of a strong list follow their template");
  const strip = a1.cx.groups.find((g) => a1.proposals[g.parent]?.cls === "list" && a1.proposals[g.parent].strength === "weak");
  assert.ok(strip && !Object.keys(a1.follow).some((k) => strip.links[k]), "a stat strip's items are decided on their own");
  // deterministic
  assert.deepEqual(collapse(buildInventory(src, { file: "f.tsx" })).stats, cx.stats);
});

test("collapse: a repeated component in different places is marked, with what varies, but not merged", () => {
  const card = (l, v) => `      <div className="card">\n        <p>${l}</p>\n        <div><span>${v}</span><b>x</b></div>\n        <em>note ${v}</em>\n      </div>`;
  const src = page(`    <main>\n      <section>\n${card("Spend", "$5M")}\n      </section>\n      <aside>\n        <h2>Other</h2>\n${card("Savings", "$9M")}\n      </aside>\n    </main>`);
  const a = analyseSrc(src);
  assert.equal(a.cx.components.length, 1);
  assert.equal(a.cx.components[0].count, 2);
  assert.ok(a.cx.components[0].varying.some((v) => v.examples.includes("Spend") || v.examples.includes("$5M")));
  assert.equal(a.cx.groups.length, 0, "different places: nothing is collapsed");
});

// ---------- classification ----------
test("classify: every node gets exactly one proposal and the coverage adds up to 100%", () => {
  for (const f of ["figma-1.tsx", "figma-2.tsx", "redesigned.tsx"]) {
    const a = analyseSrc(fx(f));
    const eff = Object.fromEntries(a.inv.nodes.filter((n) => n.id !== "root").map((n) => [n.id, effectiveOf(n, a.proposals[n.id], undefined)]));
    assert.equal(Object.keys(a.proposals).length, a.inv.nodes.length - 1);
    const cov = coverage(a.inv, eff);
    assert.equal(cov.accountedFor, 100);
    assert.equal(cov.dynamic + cov.static + cov.list + cov.action + cov.input + cov.visual + cov.structure + cov.unsure, cov.total);
    for (const p of Object.values(a.proposals)) { assert.ok(["strong", "weak"].includes(p.strength)); assert.ok(p.reasons.length >= 1, p.id); }
  }
});

test("classify: numbers, dates, deltas are dynamic; button labels, column headers and stat labels are static; a repeated row field is dynamic unless identical", () => {
  const a = analyseSrc(page(`    <main>
      <p>Spend</p><p>$38.4M</p>
      <button onClick={() => {}}>Save changes</button>
      <table><thead><tr><th>Name</th><th>Kind</th></tr></thead><tbody>
        <tr><td>Ada</td><td>Person</td></tr><tr><td>Bo</td><td>Person</td></tr><tr><td>Cy</td><td>Person</td></tr>
      </tbody></table>
    </main>`));
  const cls = (t) => a.proposals[textNode(a, t).id];
  assert.equal(cls("$38.4M").cls, "dynamic"); assert.equal(cls("$38.4M").strength, "strong");
  assert.equal(cls("Spend").cls, "static"); assert.match(cls("Spend").reasons[0], /stat/);
  assert.equal(cls("Save changes").cls, "static"); assert.match(cls("Save changes").reasons[0], /control/);
  assert.equal(cls("Name").cls, "static"); assert.match(cls("Name").reasons[0], /column header/);
  assert.equal(cls("Ada").cls, "dynamic"); assert.match(cls("Ada").reasons[0], /differs across the 3 rows/);
  assert.equal(cls("Person").cls, "static"); assert.match(cls("Person").reasons[0], /same in all 3 rows/);
  const btn = a.inv.nodes.find((n) => n.kind === "interaction");
  assert.equal(a.proposals[btn.id].cls, "action"); assert.equal(a.proposals[btn.id].name, "save");
  const list = a.inv.nodes.find((n) => n.tag === "tbody");
  assert.equal(a.proposals[list.id].cls, "list"); assert.equal(a.proposals[list.id].strength, "strong");
  assert.equal(a.proposals[a.inv.nodes.find((n) => n.tag === "table").id].delegate, list.id, "the wrapper points at the element that carries data-list");
});

test("classify: markers the page already has are shown as accepted; nothing is proposed to add again", () => {
  const a = analyseSrc(page(`    <div><p><span data-dyn="total">$5M</span></p>\n    <button data-action="save" onClick={() => {}}>Save</button></div>`));
  const t = a.proposals[textNode(a, "$5M").id];
  assert.equal(t.existing, true); assert.equal(t.name, "total");
  const b = a.inv.nodes.find((n) => n.kind === "interaction");
  assert.equal(a.proposals[b.id].existing, true);
  const eff = effectiveOf(textNode(a, "$5M"), t, undefined);
  assert.equal(eff.status, "accepted");
  assert.deepEqual(editsFor({ ...a }, {}), []);
});

test("classify: the header row is not data, a single table row is a weak dynamic cell, a text with no rule and no contract is weak static and named Unclassified", () => {
  const a = analyseSrc(page(`    <div><table><tr><th>Item</th></tr><tr><td>Widget</td></tr></table><p>Fixed words here.</p></div>`));
  assert.equal(a.proposals[textNode(a, "Item").id].cls, "static");
  const w = a.proposals[textNode(a, "Widget").id];
  assert.equal(w.cls, "dynamic"); assert.equal(w.strength, "weak"); assert.equal(w.column, "Item");
  const f = a.proposals[textNode(a, "Fixed words here.").id];
  assert.equal(f.cls, "static"); assert.equal(f.strength, "weak");
  assert.equal(a.issues[textNode(a, "Fixed words here.").id], "unclassified");
});

test("classify with a contract: an API example value is a strong hint (a bare small number only a weak one), a sentence that names an API value is unsure", () => {
  const dir = path.join(root, "examples", "portfolio-figma-1");
  const contract = contractMatcher(dir);
  assert.ok(contract && contract.fields > 10);
  assert.ok(contract.lookup("$280.2M").length >= 1);
  const a = analyseSrc(page(`    <div><p>Category</p><p>Grains & Cereals is the biggest category we manage here.</p><p>Logistics</p><p>6</p></div>`), { contract });
  const p = (t) => a.proposals[textNode(a, t).id];
  assert.equal(p("Logistics").cls, "dynamic"); assert.equal(p("Logistics").strength, "strong"); assert.match(p("Logistics").reasons[0], /equals the API example/);
  assert.equal(p("Grains & Cereals is the biggest category we manage here.").cls, "unsure");
  assert.equal(p("Grains & Cereals is the biggest category we manage here.").lean, "dynamic");
  assert.equal(a.issues[textNode(a, "Grains & Cereals is the biggest category we manage here.").id], "ambiguous");
  assert.equal(p("6").strength === "weak" || p("6").cls === "static" || p("6").cls === "dynamic", true);
  assert.equal(contractMatcher(path.join(root, "examples", "products-no-contract")), null, "no contract: nothing is claimed");
});

test("classify: the suggestMarkers verbs and rules stay ONE implementation (verbOf agrees with the import block's action names on the real pages)", () => {
  for (const f of ["figma-1.tsx", "redesigned.tsx"]) {
    const src = fx(f);
    const a = analyseSrc(src);
    for (const s of suggestMarkers(src).filter((x) => x.kind === "action")) {
      const n = a.inv.nodes.find((x) => x.kind === "interaction" && x.line === s.loc.line && x.col === s.loc.column);
      assert.ok(n, s.id);
      assert.equal(verbOf(n.details.label), s.name, s.id);
      assert.equal(a.proposals[n.id].ruleId, s.id);
    }
  }
});

// ---------- apply ----------
test("apply: accepting the rule proposals on the real pages keeps every original line, extracts the same lists, and removing the markers gives the source back", () => {
  for (const f of ["figma-1.tsx", "figma-2.tsx", "redesigned.tsx"]) {
    const src = fx(f);
    const a = analyseSrc(src);
    // accept every root proposal that came from a rule of the import block and writes dyn / list / action
    const decisions = {}, ids = new Set();
    for (const n of a.inv.nodes) {
      if (n.id === "root" || a.follow[n.id]) continue;
      const p = a.proposals[n.id];
      if (p.ruleId && ["dynamic", "list", "action"].includes(p.cls) && !p.existing) decisions[n.id] = { act: "accept", by: "rule" };
    }
    const eff = effectiveAll(a, decisions);
    for (const n of a.inv.nodes) {
      if (n.id === "root") continue;
      const p = a.proposals[n.id], e = eff[n.id];
      const decided = decisions[rootOf(a.follow, n.id)];
      if (!decided || !p.ruleId || e.cls !== p.cls || !["dynamic", "list", "action"].includes(p.cls)) continue;
      if (p.tokens) for (const t of p.tokens) if (t.ruleId) ids.add(t.ruleId); else ids.add(p.ruleId);
      else ids.add(p.ruleId);
    }
    const mine = applyDecisions(a, decisions);
    const theirs = applyMarkers(src, [...ids]);
    // a decision on a template also covers the instances whose OWN rule proposals are not listed above: compare on the sets both write
    const both = extractParts(mine.source), ref = extractParts(theirs);
    assert.deepEqual(both.lists.map((l) => l.name), ref.lists.map((l) => l.name), f);
    assert.ok(mine.source.length >= src.length);
    assert.ok(parsePage(mine.source), f);
    assert.equal(applyDecisions(a, decisions).source, mine.source, "deterministic");
    // removing the added attributes gives the original back, byte for byte (spans aside)
    const back = mine.source.replace(/<span data-dyn="\w+">([^<]*)<\/span>/g, "$1").replace(/\n\s+data-(dyn|list|action)="\w+"/g, "").replace(/ data-(dyn|list|action)="\w+"/g, "");
    assert.equal(back, src, f);
  }
});

test("apply: the same accepted set gives the same bytes as applyMarkers on a small page (attribute layout, span wrap, order independent)", () => {
  const src = page(`    <main>\n      <p>Oldest has been waiting 34 days.</p>\n      <Button\n        variant="white"\n        onClick={() => {}}\n      >\n        Open\n      </Button>\n      <b>$5.6M</b>\n    </main>`);
  const a = analyseSrc(src);
  const sugg = suggestMarkers(src);
  const decisions = {};
  for (const n of a.inv.nodes) { const p = a.proposals[n.id]; if (p?.ruleId && ["dynamic", "action"].includes(p.cls)) decisions[n.id] = { act: "accept", by: "rule" }; }
  const ids = a.inv.nodes.flatMap((n) => { const p = a.proposals[n.id]; return p?.ruleId ? (p.tokens?.map((t) => t.ruleId ?? p.ruleId) ?? [p.ruleId]) : []; });
  assert.deepEqual(new Set(ids), new Set(sugg.map((s) => s.id)));
  assert.equal(applyDecisions(a, decisions).source, applyMarkers(src, sugg.map((s) => s.id)));
});

test("apply: an accepted decision writes nothing twice, a rejected one nothing at all, an unreviewed proposal nothing; static/visual write nothing", () => {
  const src = page(`    <main><b>$5.6M</b><i>$7</i><u>Words</u></main>`);
  const a = analyseSrc(src);
  const b1 = textNode(a, "$5.6M"), b2 = textNode(a, "$7");
  assert.equal(applyDecisions(a, {}).source, src, "unreviewed: unchanged");
  const one = applyDecisions(a, { [b1.id]: { act: "accept", by: "rule" }, [b2.id]: { act: "reject", by: "user" } });
  assert.equal((one.source.match(/data-dyn/g) ?? []).length, 1);
  const marked = one.source;
  const again = analyseSrc(marked);
  assert.equal(again.proposals[textNode(again, "$5.6M").id].existing, true, "the marked copy shows it as accepted");
  assert.deepEqual(editsFor(again, {}), []);
  const u = textNode(a, "Words");
  assert.equal(applyDecisions(a, { [u.id]: { act: "change", cls: "static", by: "user" } }).source, src);
});

test("apply: marking an unsuggested text as dynamic, a control as an action, and a name collision gets a suffix", () => {
  const src = page(`    <main><p>Alpha</p><p>Beta</p><a onClick={() => {}}>Go</a></main>`);
  const a = analyseSrc(src);
  const dec = { [textNode(a, "Alpha").id]: { act: "add", cls: "dynamic", name: "thing", by: "user" }, [textNode(a, "Beta").id]: { act: "add", cls: "dynamic", name: "thing", by: "user" } };
  const out = applyDecisions(a, dec).source;
  assert.match(out, /<p data-dyn="thing">Alpha<\/p>/);
  assert.match(out, /<p data-dyn="thing2">Beta<\/p>/);
  assert.equal(extractParts(out).values.length, 2);
  const link = a.inv.nodes.find((n) => n.kind === "interaction");
  assert.match(applyDecisions(a, { [link.id]: { act: "accept", by: "rule" } }).source, /<a onClick=\{\(\) => \{\}\} data-action="go">Go<\/a>/);
});

test("apply: marking a text that sits beside an element with other text wraps only that text (no nested markers)", () => {
  const src = page(`    <p>\n      {" orders "}<span>3</span>\n    </p>`);
  const a = analyseSrc(src);
  const out = applyDecisions(a, { [textNode(a, "orders").id]: { act: "add", cls: "dynamic", name: "label", by: "user" } }).source;
  assert.match(out, /<span data-dyn="label">\{" orders "\}<\/span>/);
  assert.doesNotMatch(out, /<p[^>]*data-dyn/);
});

test("apply: accepting a whole-element rule and the values inside it never nests two data-dyn markers", () => {
  const src = page(`    <p>\n      {" orders "}<span>3</span>\n    </p>`);
  const a = analyseSrc(src);
  const dec = {};
  for (const n of a.inv.nodes) if (n.kind === "text") dec[n.id] = { act: "change", cls: "dynamic", by: "user", name: `v${Object.keys(dec).length}` };
  const out = applyDecisions(a, dec).source;
  assert.equal((out.match(/data-dyn/g) ?? []).length, 2);
  assert.doesNotMatch(out, /<p[^>]*data-dyn/);
  assert.equal(extractParts(out).values.length, 2);
});

test("apply: a sentence with numbers gets a span around the marked number only; the diff for one node is small", () => {
  const src = page(`    <p>Oldest has been waiting 34 days.</p>`);
  const a = analyseSrc(src);
  const n = textNode(a, "Oldest has been waiting 34 days.");
  const p = a.proposals[n.id];
  assert.equal(p.partial || !!p.tokens, true);
  const d = diffOf(a, n.id, { cls: "dynamic", name: p.name });
  assert.ok(d && d.added === 1 && d.removed === 1);
  assert.match(applyDecisions(a, { [n.id]: { act: "accept", by: "rule" } }).source, /waiting <span data-dyn="\w+">34<\/span> days\./);
  assert.equal(diffOf(a, n.id, { cls: "static" }), null, "static writes nothing");
});

// ---------- decisions and history ----------
test("store: decisions are sorted-key JSON in a sidecar, every change is a history line, Undo/Redo work per group, a hand edit is never overwritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-pmstore-"));
  let t = 0;
  const now = () => `t${++t}`;
  const d1 = { act: "accept", by: "rule", anchor: { line: 1, col: 1, path: "p" } }, d2 = { act: "reject", by: "user" };
  setDecisions(dir, null, "page.jsx", [{ id: "n0000000b", to: d1 }], { now });
  setDecisions(dir, null, "page.jsx", [{ id: "n0000000a", to: d2 }, { id: "n0000000c", to: d1 }], { now });
  const text = fs.readFileSync(path.join(dir, "pagemap.json"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(text).decisions), ["n0000000a", "n0000000b", "n0000000c"], "keys are sorted");
  assert.equal(readHistory(dir).length, 3);
  assert.equal(summary(dir).undo.group, "g2");
  assert.deepEqual(undo(dir, null, "page.jsx", now).ids.sort(), ["n0000000a", "n0000000c"], "a group is taken back together");
  assert.deepEqual(Object.keys(readDecisions(dir)), ["n0000000b"]);
  assert.deepEqual(redo(dir, null, "page.jsx", now).ids.sort(), ["n0000000a", "n0000000c"]);
  assert.deepEqual(Object.keys(readDecisions(dir)), ["n0000000a", "n0000000b", "n0000000c"]);
  // same decision again: nothing is written
  const before = readHistory(dir).length;
  setDecisions(dir, null, "page.jsx", [{ id: "n0000000b", to: d1 }], { now });
  assert.equal(readHistory(dir).length, before);
  // a change made by hand since: undo refuses
  const j = JSON.parse(text); j.decisions.n0000000b = { act: "reject", by: "user" };
  fs.writeFileSync(path.join(dir, "pagemap.json"), JSON.stringify(j));
  setDecisions(dir, null, "page.jsx", [{ id: "n0000000b", to: null }], { now }); // records a set from the hand-edited value
  const r = undo(dir, null, "page.jsx", now);
  assert.ok(!r.error, "undo of a change made after the hand edit works");
  fs.writeFileSync(path.join(dir, "pagemap.json"), JSON.stringify({ v: 1, page: "page.jsx", decisions: { n0000000b: { act: "accept", by: "user" } } }));
  assert.match(undo(dir, null, "page.jsx", now).error ?? "", /changed outside the Page map|nothing to undo|overwrite/i);
  // a real page keeps its own files
  setDecisions(dir, "Foo", "Foo.tsx", [{ id: "n0000000d", to: d1 }], { now });
  assert.ok(fs.existsSync(path.join(dir, "pagemap.Foo.json")) && fs.existsSync(path.join(dir, "pagemap.Foo.history.jsonl")));
});

// ---------- the service ----------
test("service: resolvePage only resolves known examples and the fixed real pages (no path can be named)", () => {
  const { env } = tmpExamples();
  for (const bad of [{ example: "../orders" }, { example: "orders/../../x" }, { example: ".." }, { example: "nope" }, { example: "" }, { example: 5 }, { file: "../../../etc/passwd" }, { file: "PortfolioHealthFigmaRebuild.tsx/../x" }, { file: "Other.tsx" }, { file: "PortfolioHealthFigmaRebuild2.tsx" }, {}]) {
    assert.throws(() => svc.resolvePage(env, bad), (e) => e instanceof svc.PagemapError && e.status === 404, JSON.stringify(bad));
  }
  const ok = svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" });
  assert.equal(ok.marked, "PortfolioHealthFigmaRebuild.marked.tsx");
  assert.equal(svc.resolvePage(env, { example: "orders" }).marked, "page.marked.jsx");
  assert.deepEqual(svc.listPages(env).files.map((f) => f.file), ["PortfolioHealthFigmaRebuild.tsx"]);
});

test("service: decide validates ids, acts, classes and names; bulk accepts every strong edit as one group; the source is never touched", () => {
  const { dir, env } = tmpExamples();
  const ref = svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" });
  const a = svc.analyse(ref);
  const p0 = svc.payload(a);
  const someText = a.inv.nodes.find((n) => n.kind === "text" && a.proposals[n.id].cls === "dynamic" && a.proposals[n.id].strength === "strong");
  const bad = (body, re) => assert.throws(() => svc.decide(a, body), (e) => e instanceof svc.PagemapError && re.test(e.message), JSON.stringify(body).slice(0, 80));
  bad({}, /Nothing to decide/);
  bad({ changes: [{ id: "n12345678", act: "accept" }] }, /not on this page/);
  bad({ changes: [{ id: "root", act: "accept" }] }, /not on this page/);
  bad({ changes: [{ id: someText.id, act: "explode" }] }, /act must be/);
  bad({ changes: [{ id: someText.id, act: "change", cls: "structure" }] }, /not a class you can mark/);
  bad({ changes: [{ id: someText.id, act: "accept", name: "9bad name" }] }, /not a usable name/);
  bad({ changes: ["x"] }, /must be an object/);
  bad({ bulk: "accept-everything" }, /bulk must be/);
  const srcBefore = fs.readFileSync(ref.pagePath, "utf8");
  svc.decide(a, { bulk: "accept-strong" });
  const p1 = svc.payload(a);
  assert.equal(p1.summary.strong, 0, "nothing strong is left waiting");
  assert.equal(p1.summary.decided, p0.summary.strong);
  assert.equal(p1.summary.proposed, p0.summary.weak);
  assert.equal(p1.history.undo.group, "g1");
  assert.equal(fs.readFileSync(ref.pagePath, "utf8"), srcBefore, "the design source is never modified");
  assert.deepEqual(fs.readdirSync(path.join(dir, "examples", "portfolio-figma-1")).sort(), ["feature.json", "openapi.json", "page.jsx", "pagemap.PortfolioHealthFigmaRebuild.history.jsonl", "pagemap.PortfolioHealthFigmaRebuild.json"], "only the sidecar files appeared");
  svc.stepHistory(a, "undo");
  assert.equal(svc.payload(a).summary.decided, 0);
  // an instance's decision is stored under its template
  const inst = Object.keys(a.follow)[0];
  svc.decide(a, { changes: [{ id: inst, act: "reject" }] });
  assert.deepEqual(Object.keys(readDecisions(ref.dir, ref.key)), [rootOf(a.follow, inst)]);
});

test("service: apply writes the marked copy next to the source (fixed name), never the page; use needs a current marked copy and an example page", () => {
  const { dir, env } = tmpExamples();
  const ex = svc.resolvePage(env, { example: "orders" });
  const a = svc.analyse(ex);
  assert.throws(() => svc.applyToCopy(a), /No accepted decision writes anything/);
  const t = a.inv.nodes.find((n) => n.kind === "text" && n.text === "$10,660");
  const orig = fs.readFileSync(ex.pagePath, "utf8");
  // the orders page is fully marked already: add a part the page lacks
  const cell = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Notes" && n.textKind === "attribute");
  const extra = a.inv.nodes.find((n) => n.kind === "text" && n.text === "orders · total value");
  svc.decide(a, { changes: [{ id: extra.id, act: "add", cls: "dynamic", name: "summaryLine" }] });
  assert.ok(t && cell);
  const r = svc.applyToCopy(a);
  assert.equal(r.written, "page.marked.jsx");
  assert.ok(fs.existsSync(path.join(dir, "examples", "orders", "page.marked.jsx")));
  assert.equal(fs.readFileSync(ex.pagePath, "utf8"), orig, "the page itself is untouched");
  assert.match(fs.readFileSync(path.join(dir, "examples", "orders", "page.marked.jsx"), "utf8"), /data-dyn="summaryLine"/);
  assert.ok(r.diff.added >= 1);
  assert.equal(svc.payload(a).marked.upToDate, true);
  // the same apply again: same bytes
  const first = fs.readFileSync(path.join(dir, "examples", "orders", "page.marked.jsx"), "utf8");
  svc.applyToCopy(a);
  assert.equal(fs.readFileSync(path.join(dir, "examples", "orders", "page.marked.jsx"), "utf8"), first);
  // use: refused when the copy is stale; works after a fresh apply; keeps a backup; decisions start over
  svc.decide(a, { changes: [{ id: extra.id, act: "rename", name: "summary2" }] });
  assert.throws(() => svc.useAsPage(a), /out of date/);
  svc.applyToCopy(a);
  const u = svc.useAsPage(a);
  assert.equal(u.used, "page.jsx");
  assert.equal(fs.readFileSync(path.join(dir, "examples", "orders", "page.before-pagemap.jsx"), "utf8"), orig);
  assert.match(fs.readFileSync(ex.pagePath, "utf8"), /data-dyn="summary2"/);
  assert.equal(fs.existsSync(path.join(dir, "examples", "orders", "pagemap.json")), false);
  // a real page is never replaced from here
  const real = svc.analyse(svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" }));
  svc.decide(real, { bulk: "accept-strong" });
  const rr = svc.applyToCopy(real);
  assert.equal(rr.written, "PortfolioHealthFigmaRebuild.marked.tsx");
  assert.ok(fs.existsSync(path.join(dir, "examples", "portfolio-figma-1", "PortfolioHealthFigmaRebuild.marked.tsx")));
  assert.ok(!fs.existsSync(path.join(dir, "subframe-app", "src", "pages", "PortfolioHealthFigmaRebuild.marked.tsx")), "nothing is written into the Subframe app");
  assert.throws(() => svc.useAsPage(real), /never replaced/);
});

test("service: a page that does not parse is a 422 with the parser's message, never a crash", () => {
  const { dir, env } = tmpExamples();
  fs.writeFileSync(path.join(dir, "examples", "orders", "page.jsx"), "export default () => <div>");
  assert.throws(() => svc.analyse(svc.resolvePage(env, { example: "orders" })), (e) => e instanceof svc.PagemapError && e.status === 422 && /does not parse/.test(e.message));
});

test("determinism: the same source and decisions give the same ids, proposals, payload and marked bytes on two runs", () => {
  const { env } = tmpExamples();
  const run = () => {
    const a = svc.analyse(svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" }));
    return a;
  };
  const a = run(), b = run();
  assert.equal(JSON.stringify(svc.payload(a)), JSON.stringify(svc.payload(b)));
  svc.decide(a, { bulk: "accept-strong" });
  const decisions = readDecisions(a.ref.dir, a.ref.key);
  const x = applyDecisions(a, decisions).source, y = applyDecisions(b, decisions).source;
  assert.equal(x, y);
  // nothing in the engine reads a clock or a random source
  for (const f of ["inventory", "collapse", "classify", "apply", "shape", "preview", "contract-match"]) {
    const text = fs.readFileSync(path.join(here, `${f}.mjs`), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(text, /Math\.random|Date\.now|new Date\(|performance\.now/, f);
  }
});

test("wireframe: every node has a box with its id, text is escaped", () => {
  const src = page(`    <div><p>{"<b>x</b> & y"}</p><input placeholder="Name" /></div>`);
  const inv = buildInventory(src, { file: "w.jsx" });
  const html = wireframe(inv);
  for (const n of inv.nodes.filter((x) => x.id !== "root")) assert.ok(html.includes(`data-pm-id="${n.id}"`), n.id);
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
});

test("the inventory's text agrees with the extractor's reading of an element (textInNode)", () => {
  const inv = buildInventory(fx("figma-1.tsx"), { file: "f.tsx" });
  const row = inv.nodes.find((n) => n.tag === "Table.Row");
  assert.match(textInNode(inv.byId, row), /^01 Logistics/);
});

// ---------- Construct's click-to-source ----------
// The wireframe maps a click to a node by id. Construct's jsxSourceAnnotator maps a click on a RENDERED host element to
// `file:line:col` of its opening `<`. The two agree by construction if Trace's node positions are the same line:col: this test
// pins that, so a rendered-page overlay can later select a tree node without guessing (see docs/PAGEMAP.md).
import { importConstructAnnotator } from "../construct.mjs";
const CONSTRUCT_CHECKOUT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";
const hasConstruct = fs.existsSync(path.join(CONSTRUCT_CHECKOUT, "packages", "engine", "jsxSourceAnnotator.mjs"));
test("Construct's data-cx-src positions equal the Page map's node positions for every host element (skipped without a checkout)", { skip: hasConstruct ? false : `no Construct checkout at ${CONSTRUCT_CHECKOUT}` }, async () => {
  const ann = await importConstructAnnotator(CONSTRUCT_CHECKOUT);
  assert.ok(ann, "the annotator loads through the adapter");
  for (const f of ["figma-1.tsx", "redesigned.tsx"]) {
    const src = fx(f);
    const { code, count } = ann.annotateJsxSource(src, { file: f });
    const theirs = [...code.matchAll(/data-cx-src="([^"]+)"/g)].map((m) => ann.parseCxSrc(m[1])).map((p) => `${p.line}:${p.column}`).sort();
    const inv = buildInventory(src, { file: f });
    const mine = inv.nodes.filter((n) => n.kind !== "text" && n.id !== "root" && /^[a-z]/.test(n.tag)).map((n) => `${n.line}:${n.col}`).sort();
    assert.equal(theirs.length, count);
    assert.deepEqual(mine, theirs, f);
  }
  assert.equal(await importConstructAnnotator(undefined), null, "no CONSTRUCT_ROOT: the caller falls back");
  assert.equal(await importConstructAnnotator("/no/such/checkout"), null);
});

// ---------- states and conditionals, flows, violations, user rules ----------
import { detectStates } from "./states.mjs";
import { handlerStub, resolveInteractions, interactionCoverage } from "./interactions.mjs";
import { buildViolations, makeViolation } from "./violations.mjs";
import { importConstructDiagnostics } from "../construct.mjs";

test("states: conditional rendering, state props, class tokens, skeletons and loading/empty/error wording become state records linked to their element", () => {
  const src = page(`    <div>
      {loading && <Spinner />}
      {items.length === 0 ? <p>Nothing here yet</p> : items.map((i) => <li key={i}>{i}</li>)}
      {ok ? <A>yes</A> : <B>no</B>}
      <button disabled={!ready} aria-busy="true">Go</button>
      <Tabs.Item active={true}>One</Tabs.Item>
      <div className="animate-pulse h-4" />
      <p>Something went wrong</p>
    </div>`);
  const inv = buildInventory(src, { file: "s.jsx" });
  const by = (k, f) => inv.states.filter((s) => s.stateKind === k && (!f || f(s)));
  assert.ok(inv.states.every((s) => s.kind === "state" && /^s[0-9a-f]{8,}$/.test(s.id) && inv.byId.has(s.target) && s.requirement && ["Product", "Design"].includes(s.team)));
  assert.equal(by("loading", (s) => s.source === "conditional")[0].condition, "loading");
  assert.equal(inv.byId.get(by("loading", (s) => s.source === "conditional")[0].target).tag, "Spinner");
  assert.equal(by("empty", (s) => s.source === "conditional")[0].condition, "items.length === 0");
  assert.deepEqual(inv.states.filter((s) => s.source === "conditional" && /^(A|B)$/.test(inv.byId.get(s.target).tag)).map((s) => [inv.byId.get(s.target).tag, s.condition, s.branch]), [["A", "ok", "then"], ["B", "not (ok)", "else"]]);
  assert.equal(by("disabled")[0].condition, "!ready"); assert.equal(by("disabled")[0].prop, "disabled");
  assert.equal(by("loading", (s) => s.prop === "aria-busy").length, 1);
  assert.equal(by("selected")[0].prop, "active");
  assert.equal(by("loading", (s) => s.source === "skeleton").length, 1);
  assert.equal(by("error").length, 1, "the wording is found");
  assert.equal(by("empty", (s) => s.source === "text").length, 0, "the wording of a state the condition already gave is not listed twice");
  assert.deepEqual(inv.states.map((s) => s.id), buildInventory(src, { file: "s.jsx" }).states.map((s) => s.id), "stable ids");
  assert.equal(detectStates({ nodes: [], byId: new Map() }, "", "x").length, 0);
  // a colour variant is a style, not a state; a slot without an operator guards nothing
  assert.equal(buildInventory(page(`    <Badge variant="error" label={<b>Is it ok?</b>}>x</Badge>`), { file: "b.jsx" }).states.length, 0);
});

test("user rules: two identical texts in different places are TWO parts (ids by position), and columns and cells are tracked by index", () => {
  const a = analyseSrc(page(`    <div><p>Total</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table><p>Total</p></div>`));
  const totals = a.inv.nodes.filter((n) => n.kind === "text" && n.text === "Total");
  assert.equal(totals.length, 2);
  assert.notEqual(totals[0].id, totals[1].id);
  assert.notEqual(`${totals[0].line}:${totals[0].col}`, `${totals[1].line}:${totals[1].col}`);
  const cells = a.inv.nodes.filter((n) => n.kind === "cell" && !n.details.header);
  assert.deepEqual(cells.map((c) => [c.details.row, c.details.col]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.deepEqual(a.inv.nodes.find((n) => n.kind === "table").details.columns.map((c) => [c.index, c.header]), [[0, "A"], [1, "B"]]);
});

test("user rule: text that is neither marked nor static is static at least (unsure counts as static until decided; nothing is written for it)", () => {
  const contract = contractMatcher(path.join(root, "examples", "portfolio-figma-1"));
  const src = page(`    <div><p>Grains & Cereals is the biggest category we manage here.</p></div>`);
  const a = analyseSrc(src, { contract });
  const eff = Object.fromEntries(a.inv.nodes.filter((n) => n.id !== "root").map((n) => [n.id, effectiveOf(n, a.proposals[n.id], undefined)]));
  const cov = coverage(a.inv, eff);
  assert.equal(cov.unsure, 1);
  assert.equal(cov.staticAtLeast, cov.static + 1);
  assert.match(cov.sentence, /1 unsure \(static until decided\)/);
  assert.equal(applyDecisions(a, {}).source, src);
});

test("flows: a stub is a function with an unused input or nothing returned; every interaction gets a resolution (api, controller, stub, unresolved)", () => {
  assert.deepEqual(handlerStub("onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}"), { present: true, stub: true, why: 'empty body, input "event" unused' });
  assert.equal(handlerStub("onClick={() => {}}").stub, true);
  assert.equal(handlerStub("onClick={(e) => go()}").stub, true, "an input that is never used");
  assert.equal(handlerStub("onClick={(e) => go(e)}").stub, false);
  assert.equal(handlerStub("onClick={() => save(id)}").stub, false);
  assert.equal(handlerStub("").present, false);
  const src = page(`    <main><button onClick={() => {}}>Save</button><button onClick={(e) => go(e)}>Delete</button><button>Frobnicate</button><button onClick={(e) => {}}>Cancel</button><button onClick={() => {}}>Wibble</button></main>`);
  const a = analyseSrc(src);
  const r = resolveInteractions(a.inv, src, a.proposals, path.join(root, "examples", "categories"));
  assert.deepEqual(r.map((x) => [x.label, x.resolution]), [["Save", "api"], ["Delete", "api"], ["Frobnicate", "unresolved"], ["Cancel", "controller"], ["Wibble", "stub"]]);
  assert.match(r[4].detail, /marked stub/);
  const none = resolveInteractions(a.inv, src, a.proposals, null);
  assert.deepEqual(none.map((x) => [x.label, x.resolution]), [["Save", "unresolved"], ["Delete", "unresolved"], ["Frobnicate", "unresolved"], ["Cancel", "controller"], ["Wibble", "stub"]], "without a contract an endpoint is never claimed, but UI-only verbs stay UI-only (as in the pipeline)");
  // on the real page every Button is a stub or unresolved, none is silently "api"
  const real = analyseSrc(fx("figma-1.tsx"));
  const rr = resolveInteractions(real.inv, fx("figma-1.tsx"), real.proposals, path.join(root, "examples", "portfolio-figma-1"));
  assert.ok(rr.length >= 10 && rr.every((x) => ["stub", "unresolved", "controller", "api"].includes(x.resolution)));
  assert.ok(rr.some((x) => x.resolution === "stub"));
  // the overall coverage figure: counts plus two readings of "resolved" (with vs without a marked stub counting as covered)
  assert.deepEqual(interactionCoverage(r), { total: 5, api: 2, controller: 1, stub: 1, unresolved: 1, rate: 80, resolvedStrict: 3, rateStrict: 60 });
  assert.deepEqual(interactionCoverage(none), { total: 5, api: 0, controller: 1, stub: 1, unresolved: 3, rate: 40, resolvedStrict: 1, rateStrict: 20 });
  assert.deepEqual(interactionCoverage([]), { total: 0, api: 0, controller: 0, stub: 0, unresolved: 0, rate: 100, resolvedStrict: 0, rateStrict: 100 }, "no interactions: reads as fully covered, not NaN");
});

test("charts: labels in a graphic are mapped to candidate data items of the contract, never guessed silently", () => {
  const contract = contractMatcher(path.join(root, "examples", "portfolio-figma-1"));
  const a = analyseSrc(page(`    <div><svg viewBox="0 0 10 10"><text>Maturity score</text><text>Spend</text><text>Zzzz qqq</text></svg><img alt="chart" src="x.png" /></div>`), { contract });
  const svg = a.inv.nodes.find((n) => n.tag === "svg");
  assert.deepEqual(svg.details.labels, ["Maturity score", "Spend", "Zzzz qqq"]);
  assert.equal(svg.details.chart, true);
  assert.ok(contract.dataItemsFor("Spend").length >= 1);
  assert.deepEqual(contract.dataItemsFor("Zzzz qqq"), []);
});

test("violations: suggested markers, states, unresolved interactions and charts are a tracked list in Construct's makeViolation shape, with a status that follows the decisions", () => {
  const { dir, env } = tmpExamples(["orders", "portfolio-figma-1"]);
  const a = svc.analyse(svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" }));
  const p0 = svc.payload(a);
  const v = p0.violations;
  assert.ok(v.length > 50);
  for (const x of v) {
    for (const k of ["rule", "severity", "file", "line", "message", "why", "expected", "suggestedFix", "id", "nodeId", "status", "team"]) assert.ok(k in x, `${x.rule}: ${k}`);
    assert.ok(Array.isArray(x.expected) && ["error", "warning", "info"].includes(x.severity) && x.file === "PortfolioHealthFigmaRebuild.tsx" && x.line >= 1);
    assert.match(x.rule, /^pagemap\/(dynamic-value|list|action|input|unsure|state\/\w+|interaction-unresolved|interaction-stub|chart-mapping)$/);
  }
  assert.equal(new Set(v.map((x) => x.id)).size, v.length, "each violation has its own id");
  assert.ok(v.every((x) => x.status === "suggested"));
  assert.ok(v.some((x) => x.rule === "pagemap/dynamic-value" && /data-dyn/.test(x.suggestedFix)));
  assert.ok(v.some((x) => x.rule === "pagemap/state/selected"));
  assert.ok(v.some((x) => x.rule === "pagemap/interaction-stub") && v.some((x) => x.rule === "pagemap/interaction-unresolved"));
  assert.deepEqual(p0.summary.violations.byStatus, { suggested: v.length });
  // a decision changes the status, and the list is stored in the sidecar
  const dyn = v.find((x) => x.rule === "pagemap/dynamic-value");
  svc.decide(a, { changes: [{ id: dyn.nodeId, act: "accept" }] });
  const stateV = svc.payload(a).violations.find((x) => x.rule === "pagemap/state/selected");
  svc.decide(a, { changes: [{ id: stateV.nodeId, act: "reject" }] });
  const p1 = svc.payload(a);
  assert.equal(p1.violations.find((x) => x.id === dyn.id).status, "confirmed");
  assert.equal(p1.violations.find((x) => x.id === stateV.id).status, "dismissed");
  assert.equal(p1.states.find((s) => s.id === stateV.nodeId).status, "dismissed");
  const side = JSON.parse(fs.readFileSync(path.join(dir, "examples", "portfolio-figma-1", "pagemap.PortfolioHealthFigmaRebuild.json"), "utf8"));
  assert.equal(side.violations.length, v.length);
  assert.equal(side.violations.find((x) => x.id === dyn.id).status, "confirmed");
  assert.deepEqual(Object.keys(side), ["decisions", "page", "v", "violations"], "sorted keys");
  svc.stepHistory(a, "undo");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "examples", "portfolio-figma-1", "pagemap.PortfolioHealthFigmaRebuild.json"), "utf8")).violations.find((x) => x.id === stateV.id).status, "suggested");
  assert.throws(() => svc.decide(a, { changes: [{ id: stateV.nodeId, act: "change", cls: "dynamic" }] }), /can only be accepted/);
  // deterministic
  assert.equal(JSON.stringify(buildViolations(a, {})), JSON.stringify(buildViolations(a, {})));
  assert.equal(makeViolation({ rule: "r", severity: "info", file: "f", line: 1, message: "m", why: "w", nodeId: "n1", status: "suggested" }).id, makeViolation({ rule: "r", severity: "info", file: "f", line: 1, message: "m", why: "w", nodeId: "n1", status: "confirmed" }).id);
});

test("violations: the field set is Construct's makeViolation contract (module is the one field Construct restricts to its own three; skipped without a checkout)", { skip: hasConstruct ? false : "no Construct checkout" }, async () => {
  const d = await importConstructDiagnostics(CONSTRUCT_CHECKOUT);
  assert.ok(d);
  const { env } = tmpExamples(["orders", "portfolio-figma-1"]);
  const a = svc.analyse(svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" }));
  for (const v of buildViolations(a, {}).slice(0, 40)) {
    const { id, nodeId, status, team, ...core } = v; // eslint-disable-line no-unused-vars
    assert.ok(d.makeViolation({ ...core, module: "readability" }), v.rule);
  }
});


// ---------- review fixes: every real page loads, orphan edits never throw, backups are never overwritten, flows agree with the pipeline ----------
import { match, ACTION_KINDS } from "../match.mjs";
import { readSpec } from "../contract.mjs";

test("all three real Subframe pages load through the service (analyse, payload, decide, apply) without an exception or a warning", () => {
  const pages = fs.readdirSync(path.join(root, "subframe-app", "src", "pages")).filter((f) => /\.tsx$/.test(f)).sort();
  assert.equal(pages.length, 3);
  const { env } = tmpExamples(["portfolio-figma-1", "portfolio-figma-2", "portfolio-redesigned"]);
  for (const f of pages) {
    const a = svc.analyse(svc.resolvePage(env, { file: f }));
    const p = svc.payload(a);
    assert.deepEqual(p.warnings, [], f);
    assert.ok(p.violations.length > 20 && p.nodes.length > 400 && p.coverage.accountedFor === 100, f);
    assert.ok(p.summary.strong > 0, f);
    svc.decide(a, { bulk: "accept-strong" });
    assert.equal(svc.applyToCopy(a).written, f.replace(/\.tsx$/, ".marked.tsx"), f);
    assert.deepEqual(svc.payload(a).warnings, [], f);
  }
});

test("an edit pointing at a missing node is an 'orphan' note, recorded and skipped: nothing throws (editSummary, violations, diffs, apply)", () => {
  const a = analyseSrc(page(`    <main><p>$5.6M</p><ul><li>Ada</li><li>Bo</li><li>Cy</li></ul><button onClick={() => {}}>Save</button></main>`));
  const ids = a.inv.nodes.filter((n) => n.id !== "root").map((n) => n.id);
  // point every proposal at things that are not there, in every way the edit builder reads
  for (const id of ids) {
    const p = a.proposals[id];
    for (const mut of [{ delegate: "nmissing00" }, { whole: "nmissing00" }, { tokens: [{ start: -3, end: 999999, name: "x" }] }, { tokens: [{ start: 5, end: 5, name: "x" }], partial: true }, { delegate: id, whole: "nmissing00", name: "" }]) {
      const saved = { ...p };
      Object.assign(p, mut);
      const dec = { [id]: { act: "accept", by: "rule" } };
      assert.doesNotThrow(() => editsFor(a, dec), id);
      assert.doesNotThrow(() => svc.PagemapError && applyDecisions(a, dec), id);
      assert.doesNotThrow(() => diffOf(a, id, { cls: p.cls === "unsure" ? p.lean : p.cls, name: p.name }), id);
      assert.doesNotThrow(() => buildViolations(a, dec), id);
      Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, saved);
    }
  }
  const ulId = a.inv.nodes.find((n) => n.tag === "ul").id;
  for (const q of Object.values(a.proposals)) if (q.id === ulId || q.delegate === ulId) q.delegate = "nmissing00"; // the list and its rows
  const out = applyDecisions(a, { [a.inv.nodes.find((n) => n.tag === "ul").id]: { act: "accept", by: "rule" } });
  assert.ok(out.skipped.some((e) => e.orphan && /orphan/.test(e.note)));
  assert.equal(out.source, a.source, "an orphan edit writes nothing");
  // the violation list marks it
  const v = buildViolations(a, {}).find((x) => x.nodeId === a.inv.nodes.find((n) => n.tag === "ul").id);
  assert.ok(!v || v.status === "orphan" || /^add|^wrap|^none/.test(v.suggestedFix));
});

test("a page that fails in a side section still loads: the section degrades to a warning, never a 500", () => {
  const { env } = tmpExamples(["portfolio-figma-1"]);
  const a = svc.analyse(svc.resolvePage(env, { file: "PortfolioHealthFigmaRebuild.tsx" }));
  const chart = a.inv.nodes.find((n) => n.kind === "visual" && n.details.chart);
  a.mappings[chart.id] = { labels: null }; // a corrupt chart mapping: the violation list cannot use it
  const p = svc.payload(a);
  assert.ok(p.warnings.length >= 1 && Array.isArray(p.violations));
});

test("positional ids: a whitespace-only edit moves the ids and orphans the decisions; they are counted, listed and can be dropped", () => {
  const { dir, env } = tmpExamples(["orders"]);
  const ref = svc.resolvePage(env, { example: "orders" });
  let a = svc.analyse(ref);
  const t = a.inv.nodes.find((n) => n.kind === "text" && n.text === "orders · total value");
  svc.decide(a, { changes: [{ id: t.id, act: "add", cls: "dynamic", name: "line" }] });
  assert.equal(svc.payload(a).summary.orphans.length, 0);
  fs.writeFileSync(ref.pagePath, "\n" + fs.readFileSync(ref.pagePath, "utf8")); // one blank line at the top
  a = svc.analyse(ref);
  assert.ok(!a.inv.byId.has(t.id), "the id moved");
  const p = svc.payload(a);
  assert.equal(p.summary.orphans.length, 1);
  assert.equal(p.summary.orphans[0].id, t.id);
  assert.equal(p.summary.orphans[0].anchor.text, "orders · total value");
  assert.throws(() => svc.decide(a, { changes: [{ id: "n00000000", act: "clear" }] }), /not on this page/);
  svc.decide(a, { changes: [{ id: t.id, act: "clear" }] });
  assert.equal(svc.payload(a).summary.orphans.length, 0);
  assert.equal(Object.keys(readDecisions(ref.dir, ref.key)).length, 0);
});

test("use as the page: the FIRST original is never overwritten; later replaced pages are numbered backups", () => {
  const { dir, env } = tmpExamples(["orders"]);
  const ref = svc.resolvePage(env, { example: "orders" });
  const orig = fs.readFileSync(ref.pagePath, "utf8");
  const one = (name, cls = "dynamic") => {
    const a = svc.analyse(ref);
    const t = a.inv.nodes.find((n) => n.kind === "text" && n.text === "orders · total value");
    svc.decide(a, { changes: [{ id: t.id, act: "add", cls, name }] });
    svc.applyToCopy(a);
    return svc.useAsPage(a);
  };
  const before = (n = "") => path.join(dir, "examples", "orders", `page.before-pagemap${n}.jsx`);
  const r1 = one("first");
  assert.equal(r1.backup, "page.before-pagemap.jsx");
  const afterFirst = fs.readFileSync(ref.pagePath, "utf8");
  assert.equal(fs.readFileSync(before(), "utf8"), orig);
  // a second use marks another text; the page it replaces (already marked once) becomes backup 2
  const b = svc.analyse(ref);
  const target = b.inv.nodes.find((n) => n.kind === "text" && n.text === "Order");
  svc.decide(b, { changes: [{ id: target.id, act: "add", cls: "dynamic", name: "second" }] });
  svc.applyToCopy(b);
  const r2 = svc.useAsPage(b);
  assert.equal(r2.backup, "page.before-pagemap.2.jsx");
  assert.equal(fs.readFileSync(before(), "utf8"), orig, "the first original is untouched");
  assert.equal(fs.readFileSync(before(".2"), "utf8"), afterFirst, "the page the second use replaced");
  const c = svc.analyse(ref);
  const t3 = c.inv.nodes.find((n) => n.kind === "text" && n.text === "Placed");
  svc.decide(c, { changes: [{ id: t3.id, act: "add", cls: "dynamic", name: "third" }] });
  svc.applyToCopy(c);
  assert.equal(svc.useAsPage(c).backup, "page.before-pagemap.3.jsx");
  assert.equal(fs.readFileSync(before(), "utf8"), orig);
});

test("flows agree with the pipeline on all 12 examples: UI-only verbs stay UI-only with or without a contract; a verb the pipeline resolves to endpoints resolves the same way", () => {
  const exDir = path.join(root, "examples");
  const names = fs.readdirSync(exDir).filter((d) => fs.existsSync(path.join(exDir, d, "feature.json"))).sort();
  assert.equal(names.length, 12);
  let compared = 0, uiOnly = 0;
  for (const name of names) {
    const dir = path.join(exDir, name);
    const spec = readSpec(dir);
    const src = fs.readFileSync(path.join(dir, spec.page ?? "page.jsx"), "utf8");
    const a = analyseSrc(src);
    const pipeline = match(extractParts(src), spec); // the pipeline's own item kinds (Fit = UI-only or an endpoint that exists)
    const kinds = new Map([...pipeline.actions, ...(pipeline.list?.actions ?? [])].map((x) => [x.name, x]));
    for (const withContract of [true, false]) {
      const res = resolveInteractions(a.inv, src, a.proposals, withContract ? dir : null);
      for (const r of res) {
        const m = kinds.get(r.verb);
        if (!m || !m.kind) continue; // not a marked action of the pipeline
        compared++;
        const ui = /no API call/.test(ACTION_KINDS[m.kind] ?? "");
        if (ui) { uiOnly++; assert.equal(r.resolution, "controller", `${name}: "${r.verb}" is UI-only in the pipeline (${withContract ? "with" : "without"} a contract)`); }
        else if (withContract && !m.missing.length) assert.equal(r.resolution, "api", `${name}: ${r.verb}`);
        else assert.equal(r.resolution, "unresolved", `${name}: ${r.verb} needs an endpoint that is ${withContract ? "missing" : "unchecked"}`);
      }
    }
  }
  assert.ok(compared > 30 && uiOnly > 10, `compared ${compared}, UI-only ${uiOnly}`);
  // the case the review found
  const src = fs.readFileSync(path.join(exDir, "products-no-contract", "page.jsx"), "utf8");
  const a = analyseSrc(src);
  const r = resolveInteractions(a.inv, src, a.proposals, path.join(exDir, "products-no-contract"));
  for (const verb of ["edit", "cancel"]) assert.ok(r.filter((x) => x.verb === verb).every((x) => x.resolution === "controller"), verb);
});

// ---------- delta review: symlinks and races, corrupt sidecars, idempotent use, shifted pages ----------
import { sanitizeDecisions, readDecisionsChecked, MAX_SIDECAR_BYTES } from "./store.mjs";

const readyToUse = (env, name = "second") => {
  const ref = svc.resolvePage(env, { example: "orders" });
  const a = svc.analyse(ref);
  const t = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Order");
  svc.decide(a, { changes: [{ id: t.id, act: "add", cls: "dynamic", name }] });
  svc.applyToCopy(a);
  return { ref, a };
};

test("use: a dangling symlink is never a free backup name and is never written through; a full set of names is a clear 409, not a 500", () => {
  const { dir, env } = tmpExamples(["orders"]);
  const d = path.join(dir, "examples", "orders");
  fs.symlinkSync(path.join(dir, "nowhere", "victim.jsx"), path.join(d, "page.before-pagemap.jsx")); // dangling
  fs.symlinkSync(path.join(dir, "nowhere", "victim2.jsx"), path.join(d, "page.before-pagemap.2.jsx"));
  const { a } = readyToUse(env);
  const r = svc.useAsPage(a);
  assert.equal(r.backup, "page.before-pagemap.3.jsx");
  assert.ok(!fs.existsSync(path.join(dir, "nowhere")), "nothing was written through the symlinks");
  assert.equal(fs.lstatSync(path.join(d, "page.before-pagemap.jsx")).isSymbolicLink(), true);
  // every name taken: 409 with a clear message, the page is not replaced
  const { dir: dir2, env: env2 } = tmpExamples(["orders"]);
  const d2 = path.join(dir2, "examples", "orders");
  for (let i = 1; i <= 50; i++) fs.writeFileSync(path.join(d2, i === 1 ? "page.before-pagemap.jsx" : `page.before-pagemap.${i}.jsx`), "x");
  const { ref: ref2, a: a2 } = readyToUse(env2);
  const before = fs.readFileSync(ref2.pagePath, "utf8");
  assert.throws(() => svc.useAsPage(a2), (e) => e instanceof svc.PagemapError && e.status === 409 && /50 backups/.test(e.message));
  assert.equal(fs.readFileSync(ref2.pagePath, "utf8"), before, "the page was not replaced");
});

test("use twice in a row is idempotent: the second answers unchanged and writes no backup", () => {
  const { dir, env } = tmpExamples(["orders"]);
  const { ref, a } = readyToUse(env);
  const first = svc.useAsPage(a);
  assert.equal(first.backup, "page.before-pagemap.jsx");
  const files = fs.readdirSync(path.join(dir, "examples", "orders")).sort();
  const again = svc.useAsPage(svc.analyse(ref));
  assert.deepEqual(again, { used: "page.jsx", backup: null, unchanged: true });
  assert.deepEqual(fs.readdirSync(path.join(dir, "examples", "orders")).sort(), files, "no new backup");
});

test("corrupt sidecars never crash a read or a decide: bad entries are dropped with a warning each", () => {
  const good = { act: "accept", by: "rule", anchor: { line: 1, col: 1, path: "p" } };
  const cases = {
    "null entry": { decisions: { n00000001: null, n00000002: good } },
    "array entry": { decisions: { n00000001: [1], n00000002: good } },
    "string entry": { decisions: { n00000001: "accept", n00000002: good } },
    "unknown act": { decisions: { n00000001: { act: "explode" }, n00000002: good } },
    "bad class": { decisions: { n00000001: { act: "change", cls: "banana" }, n00000002: good } },
    "change without class": { decisions: { n00000001: { act: "change" }, n00000002: good } },
    "bad name": { decisions: { n00000001: { act: "accept", name: "9 no" }, n00000002: good } },
    "anchor not an object": { decisions: { n00000001: { act: "accept", anchor: 5 }, n00000002: good } },
    "bad key": { decisions: { "../etc": good, n00000002: good } },
    "decisions is an array": { decisions: [good] },
    "decisions is a string": { decisions: "x" },
  };
  for (const [name, side] of Object.entries(cases)) {
    const r = sanitizeDecisions(side.decisions);
    assert.ok(Object.values(r.decisions).every((d) => d && typeof d === "object" && typeof d.act === "string"), name);
    assert.ok(r.warnings.length >= 1 || Object.keys(r.decisions).length === 1, name);
    assert.ok(!("n00000001" in r.decisions) && !("../etc" in r.decisions), name);
  }
  // through the service: every corrupt file still gives a page, a warning, and a working decide
  const files = { "not JSON": "{oops", "empty": "", "an array": "[]", "null": "null", "a string": '"x"', "null entries": JSON.stringify({ decisions: { n00000001: null, n00000002: 5 } }), "huge": "x".repeat(MAX_SIDECAR_BYTES + 10) };
  for (const [name, text] of Object.entries(files)) {
    const { dir, env } = tmpExamples(["orders"]);
    const ref = svc.resolvePage(env, { example: "orders" });
    fs.writeFileSync(path.join(dir, "examples", "orders", "pagemap.json"), text);
    const a = svc.analyse(ref);
    const p = svc.payload(a);
    assert.equal(p.summary.decided, 0, name);
    if (text.trim() !== "" && name !== "null") assert.ok(p.warnings.length >= 1, `${name}: a warning`);
    const t = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Order");
    assert.doesNotThrow(() => svc.decide(a, { changes: [{ id: t.id, act: "add", cls: "dynamic", name: "ok" }] }), name);
    assert.equal(svc.payload(a).summary.decided, 1, name);
    assert.equal(readDecisionsChecked(ref.dir, ref.key).warnings.length, 0, `${name}: decide rewrote a clean sidecar`);
  }
  assert.equal(readDecisionsChecked("/no/such/dir", null).decisions && Object.keys(readDecisionsChecked("/no/such/dir", null).decisions).length, 0);
});

test("shifted pages: a decision applies only to the node it was made on; a different node at the same position makes it an orphan, an identical node keeps it, and apply/use never mark another node", () => {
  const rows = (names) => page(`    <main><ul>\n${names.map((n) => `      <li>${n}</li>`).join("\n")}\n      <li>Zed</li>\n    </ul></main>`);
  const write = (ref, src) => fs.writeFileSync(ref.pagePath, src);
  const { dir, env } = tmpExamples(["orders"]);
  const ref = svc.resolvePage(env, { example: "orders" });
  write(ref, rows(["Ada", "Bo", "Cy"]));
  let a = svc.analyse(ref);
  const ada = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Ada");
  svc.decide(a, { changes: [{ id: ada.id, act: "add", cls: "dynamic", name: "who" }] });
  svc.applyToCopy(a);
  // 1. the first row is deleted: "Bo" moves up into the position "Ada" had, so the old id now names "Bo"
  write(ref, rows(["Bo", "Cy"]));
  a = svc.analyse(ref);
  const bo = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Bo");
  assert.equal(bo.id, ada.id, "the id collides: same position and tag path");
  let p = svc.payload(a);
  assert.equal(p.summary.orphans.length, 1);
  assert.match(p.summary.orphans[0].reason, /another node is at that position/);
  assert.equal(p.summary.decided, 0, "the decision is not live");
  assert.deepEqual(p.decisions, {});
  assert.throws(() => svc.applyToCopy(a), /No accepted decision writes anything/, "apply cannot mark Bo");
  assert.throws(() => svc.useAsPage(a), (e) => e.status === 409, "use cannot put a stale copy in place");
  assert.ok(!/data-dyn/.test(fs.readFileSync(ref.pagePath, "utf8")));
  // 2. an edit that moves everything: nothing at the old id at all
  write(ref, "\n\n" + rows(["Ada", "Bo", "Cy"]));
  a = svc.analyse(ref);
  assert.ok(!a.inv.byId.has(ada.id));
  assert.equal(svc.payload(a).summary.orphans.length, 1);
  // 3. an identical node lands there (same text, tag path and structure): the decision still describes it, so it stays live
  write(ref, rows(["Ada", "Ada", "Cy"]));
  a = svc.analyse(ref);
  const first = a.inv.nodes.find((n) => n.kind === "text" && n.text === "Ada");
  assert.equal(first.id, ada.id);
  p = svc.payload(a);
  assert.equal(p.summary.orphans.length, 0);
  assert.equal(p.decisions[ada.id].act, "change");
  const out = applyDecisions(a, p.decisions).source;
  assert.equal((out.match(/data-dyn="who"/g) ?? []).length, 1, "exactly the decided node is marked");
  assert.match(out, /<li data-dyn="who">Ada<\/li>\s*<li>Ada<\/li>/);
  // the sidecar still holds the orphan of an earlier state until the user drops it
  assert.ok(dir);
});
