// Pure-render tests for the import wizard (T13). Only data-in/HTML-out functions are tested here (no DOM), the
// same convention as src/ui/about.test.mjs and src/ui/issues.test.mjs; install*() is DOM/fetch glue and is
// exercised through a real server instead (see src/import-wizard-routes.test.mjs and server.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { stepsHtml, STEPS, listCandidates, endpointChoiceHtml, parseCandidateValue, subframeStepHtml, markerQuestionsHtml, markerStepHtml, esc } from "./import-wizard.mjs";
import { suggestMarkers } from "../import/suggest-markers.mjs";
import { MOCK_SUBFRAME_PROJECT } from "../import/subframe/fixtures/mock-project.mjs";

test("stepsHtml marks the current step and the ones before it as done, in order", () => {
  const html = stepsHtml("subframe");
  const cls = (label) => html.match(new RegExp(`<li class="([^"]*)">[^<]*<span class="n">\\d</span>${label}<`))[1];
  assert.equal(STEPS.indexOf("subframe"), 2);
  assert.equal(cls("Swagger"), "done");
  assert.equal(cls("Endpoint"), "done");
  assert.equal(cls("Subframe"), "cur");
  assert.equal(cls("Markers"), "");
});

// ---------- endpoint choice (T13.5) ----------
test("listCandidates finds a bare-array GET and an enveloped GET, and flags which one is 'current'", () => {
  const apis = [
    { method: "GET", path: "/api/orders", response: [] },
    { method: "GET", path: "/api/customers/:id", response: { name: "x" } }, // not a list candidate: no array property
    { method: "POST", path: "/api/orders", response: {} }, // not GET
    { method: "GET", path: "/api/invoices", response: { invoices: [], meta: {} } },
  ];
  const c = listCandidates(apis, "invoices");
  assert.deepEqual(c.map((x) => [x.method, x.path, x.key]), [["GET", "/api/orders", null], ["GET", "/api/invoices", "invoices"]]);
  assert.equal(c[0].current, false);
  assert.equal(c[1].current, true);
});

test("listCandidates lists every array property of an enveloped response as its own candidate", () => {
  const apis = [{ method: "GET", path: "/api/x", response: { items: [], tags: [] } }];
  const c = listCandidates(apis, null);
  assert.deepEqual(c.map((x) => x.key).sort(), ["items", "tags"]);
});

test("endpointChoiceHtml: no candidates says so plainly instead of rendering an empty picker", () => {
  const html = endpointChoiceHtml([]);
  assert.match(html, /No GET endpoint/);
  assert.doesNotMatch(html, /<input/);
});

test("endpointChoiceHtml: one candidate is preselected as 'current', a value round-trips through parseCandidateValue", () => {
  const c = listCandidates([{ method: "GET", path: "/api/orders", response: { orders: [] } }], "orders");
  const html = endpointChoiceHtml(c);
  assert.match(html, /checked/);
  assert.match(html, /GET \/api\/orders/);
  assert.match(html, /key: <code>orders<\/code>/);
  assert.deepEqual(parseCandidateValue(c[0].value), { method: "GET", path: "/api/orders", key: "orders" });
});

test("endpointChoiceHtml: a key shared by two endpoints is called out as a real limit of the existing contract reader, not silently resolved", () => {
  const c = listCandidates([
    { method: "GET", path: "/api/a", response: { items: [] } },
    { method: "GET", path: "/api/b", response: { items: [] } },
  ], null);
  const html = endpointChoiceHtml(c);
  assert.match(html, /appear on more than one endpoint/);
  assert.match(html, /src\/openapi\.mjs/);
});

test("parseCandidateValue round-trips a bare-array candidate (empty key)", () => {
  assert.deepEqual(parseCandidateValue("GET /api/orders::"), { method: "GET", path: "/api/orders", key: null });
});

// ---------- subframe step (T13.1/T13.2): never claims to be connected, always labels the fixture ----------
test("subframeStepHtml with no token set: the banner names OAuth 2.1 as the blocker, and there is no fixture without one", () => {
  const html = subframeStepHtml({ connected: false, reason: "No SUBFRAME_MCP_ACCESS_TOKEN set. mcp.subframe.com requires OAuth 2.1 (...)" }, null);
  assert.match(html, /Not connected/);
  assert.match(html, /OAuth 2\.1/);
});

test("subframeStepHtml with the recorded fixture: labels it as a fixture, never as live data, and nests components under the selected page", () => {
  const html = subframeStepHtml({ connected: false, reason: "blocked" }, MOCK_SUBFRAME_PROJECT, { pageId: "page_portfolio_health" });
  assert.match(html, /Not connected/);
  assert.match(html, /Recorded shape only; not live Subframe data/);
  assert.match(html, /Portfolio Health \(demo\)/);
  assert.match(html, /KpiRow/); // components of the selected page are shown
  assert.doesNotMatch(html, /InvoiceTable/); // the other page's components are not (not selected)
});

// ---------- markers step (T13.3): built on T18's real suggestMarkers(), not a re-implementation ----------
const PAGE = `export default function P() {\n  return (\n    <div>\n      <span>$5.6M</span>\n      <button onClick={doIt}>Refresh</button>\n    </div>\n  );\n}\n`;

test("markerQuestionsHtml renders a real suggestMarkers() question with yes/no controls, using suggestMarkers' own ids", () => {
  const suggestions = suggestMarkers(PAGE);
  assert.ok(suggestions.length > 0, "the fixture page should trigger at least one suggestion");
  const html = markerQuestionsHtml(suggestions, []);
  for (const s of suggestions) {
    assert.ok(html.includes(`data-iwyes="${s.id}"`), s.id);
    assert.ok(html.includes(esc(s.question)), s.question);
  }
});

test("markerQuestionsHtml marks an accepted id's Yes button and an empty list says so", () => {
  const suggestions = suggestMarkers(PAGE);
  const oneId = suggestions[0].id;
  const html = markerQuestionsHtml(suggestions, [oneId]);
  const yesBtn = html.match(new RegExp(`<button class="([^"]*)" data-iwyes="${oneId}">`));
  assert.ok(yesBtn, "the Yes button for the accepted id is present");
  assert.match(yesBtn[1], /\bgo\b/);
  assert.equal(markerQuestionsHtml([], []), `<p class="iw-empty">No marker suggestions found in this page.</p>`);
});

// ---------- T18.9: paste-or-upload a TSX page directly (no Subframe/MCP involved) ----------
test("markerStepHtml (T18.9): a file input sits next to the paste box, and the pasted/uploaded text round-trips into the textarea", () => {
  const html = markerStepHtml("<div>hi</div>", [], []);
  assert.match(html, /<input type="file" data-iwfile/);
  assert.match(html, /<textarea data-iwsource[^>]*>&lt;div&gt;hi&lt;\/div&gt;<\/textarea>/);
  assert.doesNotMatch(html, /Use this page/); // nothing applied yet
});

test("markerStepHtml (T18.9): strong suggestions render pre-checked, weak ones do not, matching the caller's `accepted` set", () => {
  const suggestions = suggestMarkers(PAGE);
  const strongIds = suggestions.filter((s) => s.strength === "strong").map((s) => s.id);
  assert.ok(strongIds.length > 0, "the fixture page should have at least one strong suggestion");
  const html = markerStepHtml(PAGE, suggestions, strongIds);
  for (const s of suggestions) {
    const yesBtn = html.match(new RegExp(`<button class="([^"]*)" data-iwyes="${s.id}">`));
    if (s.strength === "strong") assert.match(yesBtn[1], /\bgo\b/, `${s.id} should be pre-checked`);
    else assert.doesNotMatch(yesBtn[1], /\bgo\b/, `${s.id} (weak) should still need an explicit yes`);
  }
  assert.match(markerStepHtml(PAGE, suggestions, strongIds, "<div data-dyn=\"x\">1</div>"), /Use this page/);
});
