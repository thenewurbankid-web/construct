// Tests for the import block: parsing real Subframe TSX, extraction (golden on the 11 examples), marker suggestion and apply.
// No network, no model. Fixtures: two real Subframe pages copied from subframe-app/src/pages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePage, extractParts, suggestMarkers, applyMarkers } from "./index.mjs";
import * as constructAst from "./construct-ast.mjs";
import { extract } from "../extract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, ...p), "utf8");
const figma1 = read("fixtures", "figma-1.tsx");
const figma2 = read("fixtures", "figma-2.tsx");
const redesigned = read("fixtures", "redesigned.tsx");
const page = (jsx) => `export default function P() {\n  return (\n${jsx}\n  );\n}\n`;
const sug = (jsx, opts) => suggestMarkers(page(jsx), opts);
const find = (list, text) => list.find((s) => s.text === text);

// Extraction JSON of the 11 examples, captured (sha256) before extract() moved to Construct's AST package.
const GOLDEN = {
  categories: "f321611fb77a2ca1e6841941ab89d917bb4b6d0b4deb7b9dcddca63dce2a07f5",
  contacts: "aa0ccf4099b38f2382960a67f3db0cb0ffa0c7d3d027df880b80f307794624f9",
  deals: "1f24c5de4fd1b8f7e2b5f77af1a503a495a50b936503cbb9a95fd2ab00bc9249",
  invoices: "249ed08feeba0572360ef2a47c59a3750c2395979488390a8dfc3a3d6e4a7b30",
  metrics: "a92053bfdeefd11fef5a61147c8491d9dd796fcb06c495dfec4911b5b147a1fa",
  orders: "fc221b85f6ccc9e9ece8430bea448992553f088526e0bb092a481fe4ff5a7d19",
  "portfolio-figma-1": "22cad9220e3aa3845d09078d007704258dce69db2f96104582736a0dd26d3112",
  "portfolio-figma-2": "fe314b995307ecf414080b1de32849898200a1f92778d8736d3894f23be071d3",
  "portfolio-redesigned": "c9cf7a8b119e38f64bbbe778dba826ff2defac0bfbbf76efe02b801b59f8af0d",
  products: "7754af2a3a38c209025b1aa2d7b24e5c686a2b87753155116ed317afaa98e911",
  roster: "8ae99e9c1047e29deaa27ea1d83046fc0e4ee3951d1f093ad6209127b27931ab",
};

// ---------- the two parser modes ----------
// Construct's packages/ast is loaded from CONSTRUCT_ROOT (src/construct.mjs); without it Trace uses its own Babel code.
const CONSTRUCT_CHECKOUT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";
const probe = (root) => {
  const env = { ...process.env };
  delete env.CONSTRUCT_ROOT;
  if (root !== undefined) env.CONSTRUCT_ROOT = root;
  const r = spawnSync(process.execPath, [path.join(here, "fixtures", "engine-probe.mjs")], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const hasConstruct = fs.existsSync(path.join(CONSTRUCT_CHECKOUT, "packages", "ast", "index.mjs"));

test("without CONSTRUCT_ROOT the fallback (Babel) runs; the 5 functions exist", () => {
  const fallback = probe(undefined);
  assert.equal(fallback.engine, "babel");
  for (const fn of ["parseJsx", "walkAst", "jsxNameToString", "spliceNode", "renderAttrValue"]) assert.equal(typeof constructAst[fn], "function", fn);
  assert.equal(Object.keys(fallback.examples).length, 12); // the 11 golden examples + products-no-contract (the products page without a contract)
  assert.equal(Object.keys(fallback.fixtures).length, 3); // figma-1, figma-2, redesigned
});

test("a bad CONSTRUCT_ROOT (missing path, or a folder without packages/ast) still works, on the fallback", () => {
  const missing = probe("/no/such/construct/checkout");
  const empty = probe(here);
  assert.equal(missing.engine, "babel");
  assert.equal(empty.engine, "babel");
  assert.deepEqual(missing, probe(undefined));
});

test("with CONSTRUCT_ROOT set, Construct's AST package is used and gives the same results as the fallback (11 examples, 3 real pages: extract, suggestions, apply)", { skip: hasConstruct ? false : `no Construct checkout at ${CONSTRUCT_CHECKOUT}; set CONSTRUCT_ROOT to run this` }, () => {
  const viaConstruct = probe(CONSTRUCT_CHECKOUT);
  const viaBabel = probe(undefined);
  assert.equal(viaConstruct.engine, "construct");
  assert.equal(viaBabel.engine, "babel");
  assert.deepEqual({ ...viaConstruct, engine: "" }, { ...viaBabel, engine: "" });
});

test("the golden extraction hashes hold in both modes", { skip: hasConstruct ? false : "no Construct checkout" }, () => {
  for (const root of [undefined, CONSTRUCT_CHECKOUT]) {
    const got = probe(root).examples;
    for (const [name, hash] of Object.entries(GOLDEN)) assert.equal(got[name], hash.slice(0, 16), `${name} (${root ? "construct" : "babel"})`);
  }
});

test("extraction of the 11 examples is byte-identical to the Babel version (golden hashes)", () => {
  for (const [name, hash] of Object.entries(GOLDEN)) {
    const src = fs.readFileSync(path.join(here, "..", "..", "examples", name, "page.jsx"), "utf8");
    const json = JSON.stringify(extract(src));
    assert.equal(crypto.createHash("sha256").update(json).digest("hex"), hash, name);
  }
});

test("both real Subframe pages parse; member tags, fragments and TS syntax are read", () => {
  for (const src of [figma1, redesigned]) {
    const p = parsePage(src);
    assert.equal(p.root.tag, "div");
    assert.ok(p.elements.some((e) => e.tag === "Table.Row"));
    assert.ok(p.elements.some((e) => e.tag === "MetricCard" || e.tag === "Badge"));
  }
  assert.ok(parsePage(redesigned).elements.some((e) => e.kind === "fragment"));
  assert.ok(parsePage(redesigned).elements.some((e) => e.tag === "MetricCard.Value"));
});

test("text forms: {\"x\"}, {'x'}, plain template literal, entities, fragments, self-closing, member tags", () => {
  const src = page(`<Card.Root data-dyn="a">{"one"}{'two'}{\`three\`} &amp; four<><b>five</b></><Icon /></Card.Root>`);
  const r = extractParts(src);
  assert.deepEqual(r.values, [{ name: "a", example: "onetwothree & fourfive" }]);
  // a template literal with an expression is opaque, like any other {expression}
  assert.equal(extractParts(page("<b data-dyn=\"n\">{`a${x}`}</b>")).values[0].example, "");
  const gen = page(`<List<string> data-list="rows" items={[] as string[]}><Table.Row><td data-dyn="x">1</td></Table.Row></List>`);
  assert.equal(extractParts(gen).lists[0].rows.length, 1);
});

test("a marked list of Table.Row is read like a marked <tr> list; row actions and forms are found", () => {
  const r = extractParts(page(`<div><Table data-list="rows"><Table.Row><Table.Cell><span data-dyn="a">x</span></Table.Cell><Button data-action="open">Open</Button></Table.Row><Table.Row><span data-dyn="a">y</span></Table.Row></Table>
<form data-action="save"><input name="title" /><input name="n" type="number" /></form></div>`));
  assert.deepEqual(r.lists[0], { name: "rows", fields: ["a"], rows: [{ a: "x" }, { a: "y" }], actions: ["open"] });
  assert.deepEqual(r.forms[0].fields, [{ name: "title", type: "text" }, { name: "n", type: "number" }]);
});

test("a syntax error throws instead of returning something half-read", () => {
  assert.throws(() => parsePage("export default () => <div>"));
});

// ---------- suggestMarkers ----------

test("dyn: money, number, percent, date, ISO date, delta and N of M are strong", () => {
  const s = sug(`<div><b>$5.6M</b><b>-0.7</b><b>13.7%</b><b>31 Jul 2026</b><b>2026-07-31</b><b>▲ 8.4% YoY</b><b>23 of 60</b><b>+$5.1M</b><b>€1,200.50</b></div>`);
  for (const t of ["$5.6M", "-0.7", "13.7%", "31 Jul 2026", "2026-07-31", "▲ 8.4% YoY", "23 of 60", "+$5.1M", "€1,200.50"]) {
    assert.equal(find(s, t)?.strength, "strong", t);
    assert.equal(find(s, t).kind, "dyn");
  }
});

test("dyn false positives are weak and say why", () => {
  const s = sug(`<div><span>v1.2.3</span><span>2026</span><span>01</span><span>4 of 14 selected</span><p>We have 12 offices worldwide and more.</p></div>`);
  assert.match(find(s, "v1.2.3").risk, /version/);
  assert.match(find(s, "2026").risk, /year/);
  assert.match(find(s, "01").risk, /outside a list/);
  assert.match(find(s, "4 of 14 selected").risk, /static count/);
  const inSentence = s.find((x) => x.text === "12");
  assert.equal(inSentence.strength, "weak");
  assert.match(inSentence.risk, /sentence/);
  for (const x of s) assert.equal(x.strength, "weak", x.text);
});

test("dyn in navigation, breadcrumbs, skeletons and buttons is weak", () => {
  const s = sug(`<div><SideNav><SideNav.Item>12</SideNav.Item></SideNav><Breadcrumbs><Breadcrumbs.Item>3</Breadcrumbs.Item></Breadcrumbs><div className="animate-pulse"><span>99</span></div><Button onClick={() => {}}>5 new</Button></div>`);
  for (const t of ["12", "3", "99", "5 new"]) assert.equal(find(s, t)?.strength, "weak", t);
  assert.match(find(s, "12").risk, /navigation/);
  assert.match(find(s, "99").risk, /skeleton/);
});

test("list: Table.Row and <tr> children are strong (first is the template); 3 same-shape siblings too", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => `<Table.Row><Table.Cell><span>${i + 1}0</span></Table.Cell><Table.Cell><span>Name ${i}</span></Table.Cell><Table.Cell><span>x</span></Table.Cell></Table.Row>`).join("");
  const a = sug(`<Table header={<Table.HeaderRow><Table.HeaderCell>A</Table.HeaderCell></Table.HeaderRow>}>${rows(2)}</Table>`).filter((s) => s.kind === "list");
  assert.equal(a.length, 1);
  assert.equal(a[0].strength, "strong");
  assert.match(a[0].reason, /Table\.Row/);
  const b = sug(`<table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>`).filter((s) => s.kind === "list");
  assert.equal(b[0].tag, "tbody");
  const c = sug(`<ul>${["a", "b", "c"].map((x) => `<li><h4>${x} title</h4><p>${x} one</p><p>${x} two</p></li>`).join("")}</ul>`).filter((s) => s.kind === "list");
  assert.equal(c[0].strength, "strong");
  assert.match(c[0].reason, /3 sibling/);
  assert.equal(sug(`<ul><li><b>a</b></li><li><b>b</b></li></ul>`).filter((s) => s.kind === "list").length, 0); // two are not three
});

test("list: chip rows, stat strips, header rows and mixed parents are weak or absent", () => {
  const chips = sug(`<div><Badge>alpha</Badge><Badge>beta</Badge><Badge>gamma</Badge></div>`).find((s) => s.kind === "list");
  assert.match(chips.risk, /chip/);
  const strip = sug(`<div>${["a", "b", "c"].map((x) => `<div><span>${x} label</span><span>${x} value</span></div>`).join("")}</div>`).find((s) => s.kind === "list");
  assert.equal(strip.strength, "weak");
  const header = sug(`<Table.HeaderRow><Table.HeaderCell>A</Table.HeaderCell><Table.HeaderCell>B</Table.HeaderCell><Table.HeaderCell>C</Table.HeaderCell></Table.HeaderRow>`);
  assert.equal(header.filter((s) => s.kind === "list").length, 0);
  const mixed = sug(`<tbody><tr><td>h</td></tr><tr><td>a</td></tr><p>note</p></tbody>`).find((s) => s.kind === "list");
  assert.equal(mixed.strength, "weak");
  assert.match(mixed.risk, /non-row/);
  const nav = sug(`<SideNav>${["a", "b", "c"].map((x) => `<SideNav.Item><b>${x} one</b><i>${x} two</i><u>${x} three</u></SideNav.Item>`).join("")}</SideNav>`).find((s) => s.kind === "list");
  assert.match(nav.risk, /navigation/);
});

test("row ordinals (01, 02) are strong inside a list and weak outside; row fields are named by column header", () => {
  const s = sug(`<Table header={<Table.HeaderRow><Table.HeaderCell>#</Table.HeaderCell><Table.HeaderCell>Spend</Table.HeaderCell></Table.HeaderRow>}>
    <Table.Row><Table.Cell><span>01</span></Table.Cell><Table.Cell><span>$5M</span></Table.Cell></Table.Row>
    <Table.Row><Table.Cell><span>02</span></Table.Cell><Table.Cell><span>$6M</span></Table.Cell></Table.Row></Table>`);
  const ord = s.filter((x) => x.text === "01" || x.text === "02");
  assert.deepEqual(ord.map((x) => [x.strength, x.name]), [["strong", "rank"], ["strong", "rank"]]);
  assert.deepEqual(s.filter((x) => x.text.startsWith("$")).map((x) => x.name), ["spend", "spend"]);
});

test("action: Button/IconButton/button/a with onClick or type=submit; cancel, toggle, nav and search are weak", () => {
  const s = sug(`<div><Button onClick={() => {}}>Save changes</Button><button type="submit">Add</button><a href="#" onClick={go}>Open</a><IconButton icon={<FeatherTrash />} onClick={() => {}} />
    <Button onClick={() => {}}>Cancel</Button><Button onClick={() => {}}>Show more</Button><Button>Plain</Button><a href="/x">Link</a><IconButton icon={<FeatherSearch />} onClick={() => {}} /></div>`);
  const by = (t) => s.find((x) => x.kind === "action" && x.text === t);
  assert.deepEqual([by("Save changes").name, by("Save changes").strength], ["save", "strong"]);
  assert.deepEqual([by("Add").name, by("Add").strength], ["create", "strong"]);
  assert.equal(by("Open").name, "open");
  assert.equal(by("Trash").strength, "strong"); // label from the icon name
  assert.match(by("Cancel").risk, /cancel/);
  assert.match(by("Show more").risk, /toggle/);
  assert.equal(by("Plain"), undefined);
  assert.equal(by("Link"), undefined);
  assert.match(by("Search").risk, /search/);
});

test("form: <form> is strong; fields without a name get one; search boxes are weak", () => {
  const s = sug(`<div><form><input placeholder="Title" /><Button type="submit" onClick={f}>Save</Button></form><input type="search" placeholder="Search" /><TextField label="Email" /></div>`);
  const kinds = s.filter((x) => x.kind === "form");
  assert.equal(kinds.find((x) => x.tag === "form").name, "save");
  assert.equal(kinds.find((x) => x.text === "Title").strength, "strong");
  assert.match(kinds.find((x) => x.text === "Search").risk, /search/);
  assert.match(kinds.find((x) => x.text === "Email").risk, /no <form>/);
});

test("suggestions are sorted, unique, deterministic and carry a yes/no question", () => {
  const a = suggestMarkers(figma1);
  const b = suggestMarkers(figma1);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((s) => s.id)).size, a.length);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].loc.line < a[i].loc.line || (a[i - 1].loc.line === a[i].loc.line && a[i - 1].loc.column <= a[i].loc.column));
  }
  for (const s of a) {
    assert.match(s.question, /\?$/);
    assert.ok(["dyn", "list", "action", "form"].includes(s.kind) && ["strong", "weak"].includes(s.strength));
    if (s.strength === "weak") assert.ok(s.risk, s.id);
  }
  assert.ok(suggestMarkers(figma1, { strength: "strong" }).every((s) => s.strength === "strong"));
});

// ---------- applyMarkers ----------

test("apply: attributes land on the right element and only add text; multi-line tags keep their layout", () => {
  const src = page(`    <Table>
      <Table.Row
        className="r"
        clickable={true}
      >
        <span className="a">$5M</span>
        <Button onClick={() => {}}>Open</Button>
      </Table.Row>
      <Table.Row><span>$6M</span></Table.Row>
    </Table>`);
  const s = suggestMarkers(src);
  const out = applyMarkers(src, s.filter((x) => x.strength === "strong").map((x) => x.id));
  assert.match(out, /<Table data-list="\w+">/);
  assert.match(out, /<span className="a" data-dyn="\w+">\$5M<\/span>/);
  assert.match(out, /<Button onClick=\{\(\) => \{\}\} data-action="open">Open<\/Button>/);
  // the two hand-written lines around the multi-line tag are untouched
  assert.ok(out.includes('        className="r"\n        clickable={true}\n      >'));
  // removing the added attributes gives the original back, byte for byte
  assert.equal(out.replace(/ data-(dyn|list|action)="\w+"/g, ""), src);
});

test("apply: a multi-line opening tag gets the new attribute on its own line with the same indent", () => {
  const src = page(`    <Button
      variant="white"
      onClick={() => {}}
    >
      Open
    </Button>`);
  const out = applyMarkers(src, suggestMarkers(src).map((s) => s.id));
  assert.ok(out.includes('      onClick={() => {}}\n      data-action="open"\n    >'), out);
});

test("apply: a number inside a sentence is wrapped in a span; unknown or unaccepted ids change nothing", () => {
  const src = page(`    <p>Oldest has been waiting 34 days.</p>`);
  const s = suggestMarkers(src);
  assert.equal(s.length, 1);
  const out = applyMarkers(src, [s[0].id]);
  assert.match(out, /Oldest has been waiting <span data-dyn="\w+">34<\/span> days\./);
  assert.equal(applyMarkers(src, []), src);
  assert.equal(applyMarkers(src, ["dyn-999:1"]), src);
});

test("apply: deterministic, valid, and an element that already has the marker is left alone", () => {
  const ids = suggestMarkers(figma1).map((s) => s.id);
  const a = applyMarkers(figma1, ids);
  assert.equal(a, applyMarkers(figma1, [...ids].reverse()));
  assert.ok(parsePage(a));
  const src = page(`    <b data-dyn="mine">$5</b>`);
  assert.equal(suggestMarkers(src).length, 0);
});

// ---------- the measurement, pinned ----------

test("real pages: accepting every strong suggestion yields one 6-row list and the values extract() can read", () => {
  for (const [src, minValues] of [[figma1, 8], [redesigned, 6]]) {
    const strong = suggestMarkers(src, { strength: "strong" });
    const got = extractParts(applyMarkers(src, strong.map((s) => s.id)));
    assert.equal(got.lists.length, 1);
    assert.equal(got.lists[0].rows.length, 6);
    assert.ok(got.lists[0].fields.length >= 6);
    assert.ok(got.values.length >= minValues, `${got.values.length} values`);
    // the marked page still parses as TSX and keeps every original line
    const out = applyMarkers(src, strong.map((s) => s.id));
    assert.ok(out.length > src.length);
  }
});

test("real pages: precision of strong dyn suggestions against the hand-marked example pages stays high", () => {
  const norm = (t) => t.replace(/[▲▼]/g, "").replace(/[−–]/g, "-").replace(/\s+/g, "").toLowerCase();
  const hand = extractParts(fs.readFileSync(path.join(here, "..", "..", "examples", "portfolio-figma-1", "page.jsx"), "utf8"));
  const gt = new Set([...hand.values.map((v) => norm(v.example)), ...hand.lists.flatMap((l) => l.rows.flatMap((r) => Object.values(r).map(norm)))]);
  const strong = suggestMarkers(figma1, { strength: "strong" }).filter((s) => s.kind === "dyn");
  const hits = strong.filter((s) => gt.has(norm(s.text))).length;
  assert.ok(hits / strong.length >= 0.9, `${hits}/${strong.length}`);
  const recalled = [...gt].filter((g) => strong.some((s) => norm(s.text) === g)).length;
  assert.ok(recalled / gt.size >= 0.5, `${recalled}/${gt.size}`);
});

test("real pages: precision/recall against the redesigned page's hand-marked ground truth also stays high", () => {
  const norm = (t) => t.replace(/[▲▼]/g, "").replace(/[−–]/g, "-").replace(/\s+/g, "").toLowerCase();
  const hand = extractParts(fs.readFileSync(path.join(here, "..", "..", "examples", "portfolio-redesigned", "page.jsx"), "utf8"));
  const gt = new Set([...hand.values.map((v) => norm(v.example)), ...hand.lists.flatMap((l) => l.rows.flatMap((r) => Object.values(r).map(norm)))]);
  const strong = suggestMarkers(redesigned, { strength: "strong" }).filter((s) => s.kind === "dyn");
  const hits = strong.filter((s) => gt.has(norm(s.text))).length;
  assert.ok(hits / strong.length >= 0.9, `${hits}/${strong.length}`);
  const recalled = [...gt].filter((g) => strong.some((s) => norm(s.text) === g)).length;
  assert.ok(recalled / gt.size >= 0.5, `${recalled}/${gt.size}`);
});

// ---------- T18.11: four known extraction misses ----------

test("T18.11(a): a prefix/suffix string prop is folded into the element's own text, not dropped", () => {
  // Before the fix, textOf() ignored `prefix`/`suffix` entirely: $280 + suffix="M" extracted as "$280".
  const src = page(`<MetricCard.Value prefix="" suffix="M">$280</MetricCard.Value>`);
  assert.deepEqual(extractParts(src).values, []); // no data-dyn yet: nothing to extract
  const marked = page(`<MetricCard.Value data-dyn="v" prefix="" suffix="M">$280</MetricCard.Value>`);
  assert.deepEqual(extractParts(marked).values, [{ name: "v", example: "$280M" }]);
  // a multi-line child (whitespace before the closing tag) must not leave a stray space before the suffix
  const multiline = page(`<MetricCard.Value data-dyn="v" suffix="M">\n  $280\n</MetricCard.Value>`);
  assert.equal(extractParts(multiline).values[0].example, "$280M");
  // suggestMarkers sees the same combined text, so the question and the applied value both read "$280M"
  const s = sug(`<MetricCard.Value prefix="" suffix="M">$280</MetricCard.Value>`).find((x) => x.kind === "dyn");
  assert.equal(s.text, "$280M");
  assert.equal(s.strength, "strong");
  // reproduced against the real fixture: the raw redesigned.tsx page has this exact pattern
  const strong280 = suggestMarkers(redesigned, { strength: "strong" }).find((s) => s.text === "$280M");
  assert.ok(strong280, "the real page's MetricCard.Value(suffix=\"M\") is suggested as \"$280M\"");
});

test("T18.11(b): a section duplicated verbatim elsewhere on the page has its later copy's actions downgraded to weak", () => {
  const section = () => `<div className="s"><span>Suggestions</span><Button onClick={() => {}}>Prompt suggestion 01</Button><Button onClick={() => {}}>Prompt suggestion 02</Button></div>`;
  const src = page(`<div>${section()}<div className="filler">unrelated content in between so the two sections are not siblings-of-a-list</div>${section()}</div>`);
  const actions = suggestMarkers(src).filter((s) => s.kind === "action");
  assert.equal(actions.length, 4); // both copies are still suggested (nothing is silently dropped)...
  const byText = (t) => actions.filter((s) => s.text === t);
  assert.deepEqual(byText("Prompt suggestion 01").map((s) => s.strength), ["strong", "weak"]); // ...but only the first is strong
  assert.deepEqual(byText("Prompt suggestion 02").map((s) => s.strength), ["strong", "weak"]);
  assert.match(byText("Prompt suggestion 01")[1].risk, /identical section/);
  // reproduced against the real fixture: figma-1.tsx has this "Ask Anything" panel twice, byte-identical
  const real = suggestMarkers(figma1).filter((s) => s.kind === "action" && s.text.startsWith("Prompt suggestion"));
  assert.equal(real.length, 4);
  assert.equal(real.filter((s) => s.strength === "strong").length, 2);
  assert.equal(real.filter((s) => s.strength === "weak" && /identical section/.test(s.risk)).length, 2);
});

test("T18.11(c): a headline or narrative sentence outside any list is a weak suggestion; a plain section title next to a divider is not", () => {
  const headline = sug(`<span className="text-h5-max">Grains is carrying your portfolio. Logistics and Packaging are not.</span>`);
  const h = headline.find((s) => s.kind === "dyn");
  assert.equal(h?.strength, "weak");
  assert.match(h.reason, /headline or narrative/);
  const h1tag = sug(`<h1>Grains is carrying your portfolio. Logistics and Packaging are not.</h1>`).find((s) => s.kind === "dyn");
  assert.equal(h1tag?.strength, "weak");
  const narrative = sug(`<p className="text-body-1">Grains, up on contract coverage and a renegotiated origination mix, and Chemicals, where the solvent index fell two quarters running.</p>`).find((s) => s.kind === "dyn");
  assert.equal(narrative?.strength, "weak");
  // a static section title next to a divider line is NOT flagged (this codebase's fixtures pair every one that way)
  const title = sug(`<div><h2 className="text-h5">Your portfolio at a glance</h2><div className="h-px" /></div>`);
  assert.equal(title.filter((s) => s.kind === "dyn").length, 0);
  // reproduced against the real fixtures: the "headline" sentence is undetected before the fix, weak after
  for (const src of [figma1, figma2, redesigned]) {
    const s = suggestMarkers(src).find((x) => x.text.startsWith("Grains is carrying your portfolio"));
    assert.ok(s, "headline sentence is now suggested");
    assert.equal(s.strength, "weak");
  }
});

test("T18.11(d): a row/card marked `clickable` with no inner onClick element is an action; one with its own button is not double-counted", () => {
  const s = sug(`<Table.Row clickable={true}><Table.Cell>x</Table.Cell><FeatherChevronRight /></Table.Row>`);
  const a = s.find((x) => x.kind === "action");
  assert.equal(a?.name, "open");
  assert.equal(a.strength, "strong");
  assert.equal(a.tag, "Table.Row");
  // a row that already has its own onClick button is not suggested twice
  const withButton = sug(`<Table.Row clickable={true}><Button onClick={() => {}}>Open</Button></Table.Row>`).filter((x) => x.kind === "action");
  assert.equal(withButton.length, 1);
  assert.equal(withButton[0].text, "Open");
  // reproduced against the real fixtures: 6 clickable rows, none with an inner button, all undetected before the fix
  for (const src of [figma1, figma2, redesigned]) {
    const clickableOpens = suggestMarkers(src).filter((x) => x.kind === "action" && x.tag === "Table.Row" && x.name === "open");
    assert.equal(clickableOpens.length, 6);
    assert.ok(clickableOpens.every((x) => x.strength === "strong"));
  }
});
