// node --test tools/feature-grouper/
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadParser, DEFAULT_CONSTRUCT_ROOT } from "./construct.mjs";
import { groupPage, PageParseError } from "./grouper.mjs";
import { cluster } from "./cluster.mjs";
import { createEmbedder, createHashedEmbedder, createOllamaEmbedder, cosine } from "./embed.mjs";
import { loadFixtures, score, totals } from "./eval.mjs";
import { createServer } from "./serve.mjs";
import { demoPages, ROOT } from "./group.mjs";
import { subframePages, groupSubframePages } from "./subframe.mjs";
import { insertGroupAttributes, findEntryComponent, buildPreview, RenderError, GROUP_ATTR } from "./render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GROUP = path.join(HERE, "group.mjs");
const fixtures = loadFixtures();
const hasConstruct = fs.existsSync(path.join(DEFAULT_CONSTRUCT_ROOT, "packages", "ast", "index.mjs"));

test("there are fixtures with expected groups", () => {
  assert.ok(fixtures.length >= 3);
});

test("adapter: fallback parser always loads; Construct loads when the checkout exists", async () => {
  const fb = await loadParser("");
  assert.equal(fb.engine, "babel");
  if (hasConstruct) assert.equal((await loadParser(DEFAULT_CONSTRUCT_ROOT)).engine, "construct");
  const missing = await loadParser("/nonexistent/construct");
  assert.equal(missing.engine, "babel");
  assert.match(missing.reason, /not usable/);
});

test("both parsers give the same element tree", { skip: !hasConstruct }, async () => {
  const a = await loadParser(DEFAULT_CONSTRUCT_ROOT);
  const b = await loadParser("");
  const strip = (r) => ({ id: r.id, tag: r.tag, props: r.props, start: r.start, end: r.end, line: r.line, children: r.children.map(strip) });
  for (const f of fixtures) assert.deepEqual(a.parseJsxTree(f.source).roots.map(strip), b.parseJsxTree(f.source).roots.map(strip), f.name);
});

test("hashed embedder: unit vectors, deterministic, similar structure is closer", async () => {
  const e = createHashedEmbedder();
  const mk = (pairs) => ({ tokens: new Map(pairs), text: "" });
  const a = mk([["tag:div", 2], ["seq:h3>p", 2]]);
  const b = mk([["tag:div", 2], ["seq:h3>p", 2], ["cls:x", 1]]);
  const c = mk([["tag:form", 2], ["has:inputs", 1.5]]);
  const [va, vb, vc] = await e.embed([a, b, c]);
  assert.ok(Math.abs(cosine(va, va) - 1) < 1e-9);
  assert.ok(cosine(va, vb) > cosine(va, vc));
  assert.deepEqual(await e.embed([a]), await e.embed([a]));
});

test("cluster: merges close vectors, keeps far ones apart, is deterministic", () => {
  const vs = [[1, 0], [0.99, 0.14], [0, 1], [0.05, 0.99]].map((v) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  });
  const out = cluster(vs, 0.9);
  assert.deepEqual(out.map((c) => c.members), [[0, 1], [2, 3]]);
  assert.deepEqual(cluster(vs, 0.9), out);
  assert.deepEqual(cluster(vs, 0.999).map((c) => c.members), [[0], [1], [2], [3]]);
});

test("ollama embedder: falls back with a clear message when unreachable or the model is missing", async () => {
  const down = await createEmbedder({ kind: "ollama", env: {}, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.embedder.name, "hashed-structural");
  assert.match(down.notice, /not reachable.*Falling back/);
  const noModel = await createEmbedder({
    kind: "ollama", env: { FG_OLLAMA_MODEL: "nomic-embed-text" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: "qwen2.5vl:latest" }] }) }),
  });
  assert.equal(noModel.embedder.name, "hashed-structural");
  assert.match(noModel.notice, /"nomic-embed-text" is not installed.*ollama pull nomic-embed-text.*Falling back/);
});

test("ollama embedder: uses the model when installed (stubbed server)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/api/tags")) return { ok: true, json: async () => ({ models: [{ name: "nomic-embed-text:latest" }] }) };
    const prompt = JSON.parse(init.body).prompt;
    return { ok: true, json: async () => ({ embedding: [prompt.length, 1, 0] }) };
  };
  const { embedder, notice } = await createEmbedder({ kind: "ollama", env: {}, fetchImpl });
  assert.equal(notice, null);
  assert.equal(embedder.name, "ollama:nomic-embed-text");
  const vs = await embedder.embed([{ text: "abc" }, { text: "abcdef" }]);
  assert.equal(vs.length, 2);
  assert.ok(Math.abs(Math.hypot(...vs[0]) - 1) < 1e-9);
  assert.equal(calls.filter((u) => u.endsWith("/api/embeddings")).length, 2);
  assert.equal(createOllamaEmbedder({ model: "m" }).name, "ollama:m");
});

test("unknown embedder is an error, not a silent default", async () => {
  await assert.rejects(createEmbedder({ kind: "nope" }), /unknown embedder/);
});

test("groupPage is deterministic and JSON-serialisable", async () => {
  for (const f of fixtures) {
    const a = await groupPage(f.source, { file: f.name });
    const b = await groupPage(f.source, { file: f.name });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(a.groups.map((g) => g.id), a.groups.map((_, i) => `g${i + 1}`));
  }
});

test("groupPage: found groups match the hand-written expectations (hashed embedder)", async () => {
  const rows = [];
  for (const f of fixtures) rows.push({ s: score(await groupPage(f.source, { file: f.name }), f.expected) });
  const t = totals(rows);
  assert.equal(t.matched, t.expected, JSON.stringify(t));
  assert.ok(t.kindOk / t.expected >= 0.9, JSON.stringify(t));
});

test("groupPage: repeating siblings become one repeating group, a form becomes a unique group", async () => {
  const f = fixtures.find((x) => x.name === "dashboard.tsx");
  const r = await groupPage(f.source, {});
  const cards = r.groups.find((g) => g.kind === "repeating");
  assert.equal(cards.memberCount, 3);
  assert.deepEqual(cards.members.map((m) => m.tag), ["article", "article", "article"]);
  const form = r.groups.find((g) => g.members[0].tag === "form");
  assert.equal(form.kind, "unique");
  assert.equal(form.component, "Dashboard");
});

test("groupPage: a group whose container is a bare Fragment gets a real label, not the word Fragment", async () => {
  // Mirrors the subframe-app "redesigned" page: a `mainMenu={<>...</>}` prop wrapping repeated same-tag
  // sections, so the group's lowest common ancestor is the Fragment, not a real element.
  const src = `
export default function Page() {
  return (
    <Nav mainMenu={
      <>
        <Section label="A"><Item /><Item /></Section>
        <Section label="B"><Item /><Item /></Section>
        <Section label="C"><Item /><Item /></Section>
      </>
    } />
  );
}`;
  const r = await groupPage(src, {});
  const g = r.groups.find((x) => x.members[0].tag === "Section");
  assert.equal(g.kind, "repeating");
  assert.equal(g.memberCount, 3);
  assert.equal(g.container.tag, "3x Section (via Fragment)");
});

test("groupPage: a Fragment container with mixed-tag children falls back to the nearest non-fragment ancestor", async () => {
  const src = `
export default function Page() {
  return (
    <Nav>
      <>
        <Header />
        <Section label="A"><Item /><Item /></Section>
        <Section label="B"><Item /><Item /></Section>
      </>
    </Nav>
  );
}`;
  const r = await groupPage(src, {});
  const g = r.groups.find((x) => x.members[0].tag === "Section");
  assert.equal(g.container.tag, "Nav (via Fragment)");
});

test("groupPage: trivial pages give no groups, syntax errors and empty input throw PageParseError", async () => {
  assert.equal((await groupPage("export const A = () => <div><b /></div>;")).groups.length, 0);
  await assert.rejects(groupPage("const a = <div"), PageParseError);
  await assert.rejects(groupPage("export const x = 1;"), /no JSX elements/);
});

test("the demo-app pages all group without error", async () => {
  const pages = demoPages();
  assert.ok(pages.length >= 5);
  for (const p of pages) assert.ok((await groupPage(fs.readFileSync(p, "utf8"), { file: p })).groups.length >= 1, p);
});

test("CLI: file, --json, stdin, exit codes", () => {
  const fx = path.join(HERE, "fixtures", "dashboard.tsx");
  const text = execFileSync("node", [GROUP, fx], { encoding: "utf8" });
  assert.match(text, /g2\s+repeating\s+Dashboard\s+lines 20-34\s+3 members/);
  const json = JSON.parse(execFileSync("node", [GROUP, fx, "--json"], { encoding: "utf8" }));
  assert.equal(json.groups.length, 4);
  assert.equal(execFileSync("node", [GROUP, fx, "--json"], { encoding: "utf8" }), execFileSync("node", [GROUP, fx, "--json"], { encoding: "utf8" }));
  const viaStdin = spawnSync("node", [GROUP, "-", "--json"], { input: fs.readFileSync(fx, "utf8"), encoding: "utf8" });
  assert.equal(viaStdin.status, 0);
  assert.equal(JSON.parse(viaStdin.stdout).groups.length, 4);
  const bad = spawnSync("node", [GROUP, "-"], { input: "const a = <div", encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /cannot parse <stdin>/);
  assert.equal(spawnSync("node", [GROUP, "/no/such/file.tsx"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync("node", [GROUP], { encoding: "utf8" }).status, 1);
  assert.equal(spawnSync("node", [GROUP, fx, "--threshold", "abc"], { encoding: "utf8" }).status, 1);
});

test("CLI: --threshold changes the grouping", () => {
  const fx = path.join(HERE, "fixtures", "profile.tsx");
  const run = (th) => JSON.parse(execFileSync("node", [GROUP, fx, "--json", "--threshold", th], { encoding: "utf8" }));
  const lo = run("0.3");
  const hi = run("0.95");
  assert.equal(lo.threshold, 0.3);
  assert.equal(hi.threshold, 0.95);
  assert.notDeepEqual(lo.groups, hi.groups);
});

test("both parser engines give identical groups", { skip: !hasConstruct }, async () => {
  const a = await loadParser(DEFAULT_CONSTRUCT_ROOT);
  const b = await loadParser("");
  for (const f of fixtures) {
    const x = await groupPage(f.source, { parser: a });
    const y = await groupPage(f.source, { parser: b });
    assert.deepEqual(x.groups, y.groups, f.name);
  }
});

test("CLI: --demo runs every demo page", () => {
  const out = execFileSync("node", [GROUP, "--demo"], { encoding: "utf8" });
  assert.equal((out.match(/\[parser=/g) ?? []).length, demoPages().length);
});

test("subframe-app: pages are discovered from App.tsx's router and all group without error (no server, no browser)", async () => {
  const pages = subframePages();
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.route), ["redesigned", "figma-1", "figma-2"]);
  for (const p of pages) assert.ok(fs.existsSync(p.file), p.file);
  const grouped = await groupSubframePages();
  for (const g of grouped) {
    assert.ok(g.result.groups.length >= 5, g.route);
    assert.ok(g.result.groups.some((x) => x.kind === "repeating"), g.route);
  }
});

test("figma-1 subframe page: the 'categories/spend summary' vs 'portfolio at a glance' pair stays a near-threshold "
  + "repeating group (regression pin)", async () => {
  // This pair sits close to the merge threshold (cosine ~0.856 vs. 0.85) after the describe.mjs signature fix
  // (nchild:/branch: tokens) sharpened structural comparison across the codebase. It's a genuine match, not a
  // false merge, but its margin is thin enough that an unrelated future change to describe.mjs or the threshold
  // could silently drop it below 0.85 and split it apart without any test noticing. Pin it here so that happens
  // loudly instead.
  const page = subframePages().find((p) => p.route === "figma-1");
  assert.ok(page, "figma-1 page not found in subframe-app's router (App.tsx PAGES map)");
  const source = fs.readFileSync(page.file, "utf8");
  const r = await groupPage(source, { file: page.file });
  const g = r.groups.find((grp) => grp.kind === "repeating" && grp.members.some((m) => m.line === 85) && grp.members.some((m) => m.line === 150));
  assert.ok(g, "expected a repeating group pairing the line-85 ('Your categories'/portfolio summary) and line-150 "
    + "('portfolio at a glance') blocks in PortfolioHealthFigmaRebuild.tsx -- if the page's line numbers moved, "
    + "update this pin to the new lines rather than deleting it");
  assert.ok(g.similarity >= 0.85, `thin-margin cluster dropped below the 0.85 merge threshold (similarity `
    + `${g.similarity}) -- these two blocks are no longer recognised as one repeating group`);
});

test("insertGroupAttributes: adds data-group after the tag name, back to front, one per member", () => {
  const source = "const A = () => (<div><section>x</section><p>y</p></div>);";
  const nodes = [
    { id: "n0", tag: "div", start: source.indexOf("<div"), end: source.lastIndexOf("</div>") + "</div>".length },
    { id: "n1", tag: "section", start: source.indexOf("<section"), end: source.indexOf("</section>") + "</section>".length },
    { id: "n2", tag: "p", start: source.indexOf("<p"), end: source.indexOf("</p>") + "</p>".length },
  ];
  const groups = [
    { id: "g1", members: [{ id: "n1" }] },
    { id: "g2", members: [{ id: "n0" }, { id: "n2" }] },
  ];
  const out = insertGroupAttributes(source, nodes, groups);
  assert.match(out, /<section data-group="g1">x<\/section>/);
  assert.match(out, /<div data-group="g2"><section/);
  assert.match(out, /<p data-group="g2">y<\/p>/);
});

test("insertGroupAttributes: throws when a member id isn't in nodes (out-of-sync inputs, not silently skipped)", () => {
  assert.throws(() => insertGroupAttributes("<div/>", [], [{ id: "g1", members: [{ id: "n0" }] }]), /no node "n0"/);
});

test("findEntryComponent: default export beats an exported or bare declaration; reports which tier it picked", async () => {
  const { PARSER } = await import("./construct.mjs");
  const astOf = (src) => PARSER.parseJsxTree(src).ast;
  assert.deepEqual(findEntryComponent(astOf("export default function Page(){ return <div/>; }")), { name: "Page", tier: "default" });
  assert.deepEqual(findEntryComponent(astOf("export const Page = () => <div/>;")), { name: "Page", tier: "exported" });
  assert.deepEqual(findEntryComponent(astOf("function Helper(){return <b/>;}\nfunction Page(){ return <div/>; }")), { name: "Page", tier: "declared" });
  assert.deepEqual(findEntryComponent(astOf("export default () => <div/>;")), { name: null, tier: "anonymous-default" });
  assert.equal(findEntryComponent(astOf("const x = 1;")), null);
});

test("buildPreview: bundles a fixture, tags every member with data-group, and names the entry component", async () => {
  const f = fixtures.find((x) => x.name === "dashboard.tsx");
  const result = await groupPage(f.source, { file: f.name });
  const { code, entry, groups } = await buildPreview(f.source, { file: f.name, groupResult: result });
  assert.equal(entry.tier, "default");
  assert.equal(entry.name, "Dashboard");
  assert.deepEqual(groups, result.groups);
  // esbuild compiles the injected JSX attribute to a createElement prop, e.g. `"data-group": "g1"`.
  for (const g of result.groups) assert.ok(code.includes(`${GROUP_ATTR}": "${g.id}"`), g.id);
  assert.equal((code.match(new RegExp(GROUP_ATTR, "g")) ?? []).length, result.groups.reduce((s, g) => s + g.members.length, 0));
  assert.match(code, /window\.__FG_ENTRY__/);
});

test("buildPreview: no component found, and an unresolved relative import, are both a clear RenderError (not a guess)", async () => {
  await assert.rejects(buildPreview("export const x = 1;\nconst A = <div/>;"), (e) => e instanceof RenderError && /no top-level page component/.test(e.message));
  await assert.rejects(
    buildPreview('import Row from "./nope-does-not-exist.jsx";\nexport default function Page(){ return <div><Row/></div>; }'),
    (e) => e instanceof RenderError,
  );
});

test("web page server: page, demo list, grouping, errors", async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<textarea id="src"/);
    const demo = await (await fetch(`${base}/api/demo`)).json();
    assert.ok(demo.pages.length >= 5);
    const post = (body) => fetch(`${base}/api/group`, { method: "POST", body: JSON.stringify(body) });
    const ok = await post({ source: fixtures[0].source, threshold: "0.85", embedder: "hashed" });
    assert.equal(ok.status, 200);
    const direct = await groupPage(fixtures[0].source, { file: "<pasted>", threshold: 0.85 });
    assert.deepEqual(await ok.json(), JSON.parse(JSON.stringify(direct)));
    assert.equal((await post({ source: "const a = <div" })).status, 422);
    assert.equal((await post({ source: "  " })).status, 400);
    assert.equal((await post({ source: "x", threshold: "abc" })).status, 400);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/demo?i=999`)).status, 404);

    const react = await fetch(`${base}/vendor/react.js`);
    assert.equal(react.status, 200);
    assert.match(await react.text(), /React/);
    assert.equal((await fetch(`${base}/vendor/react-dom.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/nope.js`)).status, 404);

    const render = (body) => fetch(`${base}/api/render`, { method: "POST", body: JSON.stringify(body) });
    const rok = await render({ source: fixtures[0].source, file: fixtures[0].name });
    assert.equal(rok.status, 200);
    const rjson = await rok.json();
    assert.match(rjson.code, /__FG_ENTRY__/);
    assert.ok(rjson.groups.length > 0);
    assert.equal((await render({ source: "  " })).status, 400);
    assert.equal((await render({ source: "export const x = 1;" })).status, 422);

    // A known demo page's relative path resolves its sibling import for real; an unknown path (or "<pasted>")
    // leaves that same relative import unresolved -- the file-location-based limitation documented in render.mjs.
    const demoPage = demo.pages.find((p) => /Page\.(t|j)sx$/.test(p));
    const demoSource = fs.readFileSync(path.join(ROOT, demoPage), "utf8");
    if (/^import .* from ["']\.\.?\//m.test(demoSource)) {
      const asDemo = await render({ source: demoSource, file: demoPage });
      const asPasted = await render({ source: demoSource, file: "<pasted>" });
      assert.equal(asDemo.status, 200, await asDemo.clone().text());
      assert.equal(asPasted.status, 422);
    }
  } finally {
    server.close();
  }
});
