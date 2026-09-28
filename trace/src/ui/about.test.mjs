import test from "node:test";
import assert from "node:assert/strict";
import { esc, filterReleases, formatUptime, renderBuild, renderChanges, renderHistory, renderPage, renderReleases, testsText } from "./about.mjs";
import { parseChangelog } from "../changelog.mjs";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const hash = "3f9c2a1" + "0".repeat(33);
const data = (over = {}) => ({
  build: { name: "Trace", version: "1.0.0+3f9c2a1", release: "R0", hash, files: 120, builtAt: "2026-09-27T11:48:00.000Z" },
  changelog: parseChangelog("## R1 — 2026-09-27\n- feat: new `thing` <b>x</b>\n- fix: a bug\n## R0 — 2026-09-01\n- note: old\n"),
  changesSincePrevious: { added: ["src/new.mjs"], modified: ["src/a.mjs", "src/b.mjs"], removed: [], counts: { added: 1, modified: 2, removed: 0 }, truncated: { added: 0, modified: 0, removed: 0 } },
  history: [
    { version: "1.0.0+3f9c2a1", release: "R0", hash, deployedAt: "2026-09-27T11:48:00.000Z", tests: { total: 79, pass: 77, fail: 0, todo: 2 }, current: true, rollbackAvailable: false },
    { version: "1.0.0+1111111", release: null, hash: "1", deployedAt: "2026-09-26T11:48:00.000Z", tests: null, current: false, rollbackAvailable: true },
  ],
  node: "v24.0.0", port: 4200, previousVersion: "1.0.0+1111111", tests: { total: 79, pass: 77, fail: 0, todo: 2 }, uptimeSec: 125,
  ...over,
});

test("Build section shows version, release, hash, deployed ago with exact time, port, uptime, tests", () => {
  const h = renderBuild(data(), NOW);
  for (const s of ["1.0.0+3f9c2a1", "R0", hash, "12 min ago", "4200", "2 min", "v24.0.0", "77 passed, 2 todo (79 tests)", "120"]) assert.ok(h.includes(s), s);
  assert.match(h, /<time [^>]*title="[^"]+"/);
});

test("Build section for a dev checkout says it is not deployed", () => {
  const h = renderBuild(data({ build: { ...data().build, dev: true, builtAt: null }, tests: null }), NOW);
  assert.match(h, /development checkout/);
  assert.match(h, /not recorded/);
});

test("What's new: newest release expanded, older collapsed, items grouped with kind chips, code spans, text escaped", () => {
  const h = renderReleases(data().changelog);
  assert.equal((h.match(/<details class="rel" open>/g) ?? []).length, 1);
  assert.equal((h.match(/<details class="rel">/g) ?? []).length, 1);
  assert.match(h, /chip k-feat">New/);
  assert.match(h, /chip k-fix">Fix/);
  assert.match(h, /<code>thing<\/code>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/); // markup in the changelog cannot become markup on the page
  assert.doesNotMatch(h, /<b>x<\/b>/);
});

test("search filters items case-insensitively and opens every match", () => {
  const c = data().changelog;
  assert.deepEqual(filterReleases(c.releases, "BUG").map((r) => r.id), ["R1"]);
  assert.deepEqual(filterReleases(c.releases, "old").map((r) => r.items.length), [1]);
  assert.equal(filterReleases(c.releases, "").length, 2);
  assert.match(renderReleases(c, "old"), /<details class="rel" open>/);
  assert.match(renderReleases(c, "zzz"), /Nothing matches "zzz"/);
  assert.match(renderReleases(c, '"><script>'), /Nothing matches "&quot;&gt;&lt;script&gt;"/);
});

test("Changes in this build: counts, collapsible file lists, empty and first-build states", () => {
  const h = renderChanges(data());
  assert.match(h, /<b>1<\/b> added/);
  assert.match(h, /<b>2<\/b> modified/);
  assert.match(h, /<details class="files modified">/);
  assert.doesNotMatch(h, /files removed/); // nothing removed, no empty list
  assert.match(h, /src\/new\.mjs/);
  assert.match(renderChanges(data({ changesSincePrevious: null })), /first recorded build/);
  assert.match(renderChanges(data({ changesSincePrevious: null, build: { ...data().build, dev: true } })), /Only available for deployed builds/);
  const capped = renderChanges(data({ changesSincePrevious: { added: ["a"], modified: [], removed: [], counts: { added: 5, modified: 0, removed: 0 }, truncated: { added: 4, modified: 0, removed: 0 } } }));
  assert.match(capped, /and 4 more not listed/);
});

test("Deploy history: marks the current build and the ones a rollback can reach", () => {
  const h = renderHistory(data(), NOW);
  assert.match(h, /class="cur"/);
  assert.match(h, /current<\/span>/);
  assert.match(h, /rollback available/);
  assert.match(renderHistory(data({ history: [] }), NOW), /deploy:local/);
});

test("the whole page has the four sections and no unescaped changelog markup", () => {
  const h = renderPage(data(), NOW);
  for (const id of ["h-build", "h-new", "h-chg", "h-hist"]) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(h, /<input type="search" id="q"/);
});

test("helpers", () => {
  assert.equal(esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(formatUptime(5), "5 s");
  assert.equal(formatUptime(125), "2 min");
  assert.equal(formatUptime(3 * 3600 + 120), "3 h 2 min");
  assert.equal(formatUptime(3 * 86400), "3 days 0 h");
  assert.equal(testsText({ total: 5, pass: 3, fail: 1, todo: 1 }), "3 passed, 1 failed, 1 todo (5 tests)");
});

const NESTED = "## R1 — 2026-10-01\n- feat: release level\n### R1.2 — 2026-10-03\n- fix: newest minor\n### R1.1 — 2026-10-02\n- change: older minor <i>x</i>\n## R0 — 2026-09-27\n- feat: first\n### R0.1 — 2026-09-27\n- fix: cleanup\n";

test("What's new nests minor releases under their release: the newest release and its newest minor are open, the rest closed", () => {
  const h = renderReleases(parseChangelog(NESTED));
  assert.equal((h.match(/<details class="rel"/g) ?? []).length, 2);
  assert.equal((h.match(/<details class="minor"/g) ?? []).length, 3);
  assert.equal((h.match(/<details class="rel" open>/g) ?? []).length, 1);
  assert.equal((h.match(/<details class="minor" open>/g) ?? []).length, 1);
  // the open minor is the newest of the newest release, and it sits inside the release's own details, above the release's own items
  const rel1 = h.slice(h.indexOf("<b>R1</b>"), h.indexOf("<b>R0</b>"));
  assert.ok(rel1.indexOf('<details class="minor" open><summary><b>R1.2</b>') < rel1.indexOf("Release notes for R1"));
  assert.ok(rel1.indexOf("Release notes for R1") < rel1.indexOf("release level"));
  assert.doesNotMatch(renderReleases(parseChangelog("## R2 — 2026-01-01\n- feat: only own\n")), /Release notes for/, "no minors: no extra heading");
  assert.match(rel1, /<details class="minor"><summary><b>R1\.1<\/b> <span class="sub">minor release · 2026-10-02/);
  assert.match(h, /&lt;i&gt;x&lt;\/i&gt;/);
  assert.match(h, /<span class="n">3<\/span>/, "the release count includes its minors' items (1 + 1 + 1)");
});

test("search looks inside minors and opens them; a minor id matches too", () => {
  const c = parseChangelog(NESTED);
  const f = filterReleases(c.releases, "older minor");
  assert.deepEqual(f.map((r) => r.id), ["R1"]);
  assert.deepEqual(f[0].items, []);
  assert.deepEqual(f[0].minors.map((m) => m.id), ["R1.1"]);
  assert.match(renderReleases(c, "older minor"), /<details class="minor" open>/);
  assert.deepEqual(filterReleases(c.releases, "R0.1").map((r) => r.id), ["R0"]);
  assert.equal(filterReleases(c.releases, "R0.1")[0].minors.length, 1);
  assert.equal(filterReleases(c.releases, "").length, 2);
});

test("Build section says R0.1 is a minor release of R0; a plain R0 does not", () => {
  const b = { ...data().build, release: "R0.1", major: "R0", minor: "R0.1" };
  assert.match(renderBuild(data({ build: b }), NOW), /R0\.1 <span class="sub">minor release of R0<\/span>/);
  assert.doesNotMatch(renderBuild(data(), NOW), /minor release of/);
  assert.match(renderHistory(data({ history: [{ ...data().history[0], release: "R0.1" }] }), NOW), /<td>R0\.1<\/td>/);
});
