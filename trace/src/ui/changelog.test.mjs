import test from "node:test";
import assert from "node:assert/strict";
import { renderCurrent, renderNext, renderPage } from "./changelog.mjs";
import { parseChangelog, parseNext } from "../changelog.mjs";

const changelog = parseChangelog("## R1 — 2026-09-27\n- feat: new `thing` <b>x</b>\n- fix: a bug\n## R0 — 2026-09-01\n- note: old\n");
const next = parseNext("- R1.1 — a planned capability (LIN-1, ETA 2026-10-01)\n");
const data = (over = {}) => ({ build: { release: "R1" }, changelog, next, ...over });

test("current-release banner names the running release", () => {
  const h = renderCurrent({ release: "R6.1" });
  assert.match(h, /You are on/);
  assert.match(h, /<b>R6\.1<\/b>/);
});

test("current-release banner says when it is a dev checkout", () => {
  const h = renderCurrent({ release: "R6.1", dev: true });
  assert.match(h, /development checkout/);
});

test("current-release banner handles no release recorded", () => {
  const h = renderCurrent({ release: null });
  assert.match(h, /No release recorded/);
});

test("the page renders the current banner and every release, newest first, with kind chips", () => {
  const h = renderPage(data());
  assert.match(h, /You are on <b>R1<\/b>/);
  assert.match(h, /<h1 id="h-log">Changelog<\/h1>/);
  assert.match(h, /chip k-feat">New/);
  assert.match(h, /chip k-fix">Fix/);
  assert.ok(h.indexOf(">R1<") < h.indexOf(">R0<"));
  assert.match(h, /<code>thing<\/code>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/); // escaped, never becomes markup
});

test("search text filters the rendered release list", () => {
  const h = renderPage(data(), "bug");
  assert.match(h, /a bug/);
  assert.doesNotMatch(h, />old</);
});

test("no CHANGELOG.md entries: says so instead of an empty list", () => {
  const h = renderPage(data({ changelog: parseChangelog("") }));
  assert.match(h, /No CHANGELOG\.md entries yet/);
});

test("renderNext lists the planned capabilities with their task and ETA", () => {
  const h = renderNext(parseNext("- R1.1 — a planned capability (LIN-1, ETA 2026-10-01)\n- R1.2 — another one (LIN-2, ETA soon)\n"));
  assert.match(h, /Coming next/);
  assert.match(h, /<b>R1\.1<\/b> a planned capability/);
  assert.match(h, /LIN-1 · ETA 2026-10-01/);
  assert.match(h, /<b>R1\.2<\/b> another one/);
});

test("renderNext on an empty NEXT.md says nothing is planned yet", () => {
  assert.match(renderNext(parseNext("")), /Nothing planned yet/);
  assert.match(renderNext(undefined), /Nothing planned yet/);
});

test("the page includes the Coming next section above the release history", () => {
  const h = renderPage(data());
  assert.ok(h.indexOf("Coming next") < h.indexOf("Changelog</h1>"));
  assert.match(h, /LIN-1 · ETA 2026-10-01/);
});

test("renderNext shows a Building now badge on a building item and lists it before an earlier non-building item", () => {
  const h = renderNext(parseNext(
    "- R1.1 — a planned one, listed first in the file (LIN-1, ETA 2026-10-01)\n" +
    "- R1.2 [building] — a building one, listed second in the file (LIN-2, ETA today)\n"
  ));
  assert.match(h, /aria-label="Building now"/);
  assert.match(h, /Building now/);
  assert.ok(h.indexOf("R1.2") < h.indexOf("R1.1"), "the building item sorts before the earlier planned item");
});

test("renderNext renders an item's changes as a visible sub-list", () => {
  const h = renderNext(parseNext(
    "- R1.1 [planned] — a real one (LIN-1, ETA soon)\n  - first change\n  - second change\n"
  ));
  assert.match(h, /<ul class="next-changes">/);
  assert.match(h, /<li>first change<\/li>/);
  assert.match(h, /<li>second change<\/li>/);
});
