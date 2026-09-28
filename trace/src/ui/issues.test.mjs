// The issue registry and the classification of parts: one entry per kind, plain words, and a new kind is one entry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ISSUES, FORMS, KINDS, classify, underlying, formFor, badgeHtml, issue } from "./issues.mjs";
import { bannedIn } from "./vocab.mjs";
import { computeState } from "../inspector/state.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = (name) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trace-issues-")), "examples", name);
  fs.cpSync(path.join(root, "examples", name), dir, { recursive: true });
  for (const f of ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"]) fs.rmSync(path.join(dir, f), { force: true });
  return dir;
};

test("every kind names itself in plain words, with a colour token, an explanation and a question form", () => {
  assert.deepEqual(KINDS, ["gap", "tie", "stub", "ask", "noEndpoint", "formInput", "noInput", "unclassified", "ambiguous"]);
  for (const [kind, k] of Object.entries(ISSUES)) {
    assert.ok(k.label && k.words && k.explain.length > 40, kind);
    assert.match(k.color, /^var\(--[a-z-]+\)$/, `${kind} uses a colour token, never a literal colour`);
    assert.ok(k.form === "same-as-underlying" || FORMS[k.form], `${kind} has a question form`);
    assert.deepEqual(bannedIn(`${k.label} ${k.words} ${k.explain}`), [], `${kind} keeps the pipeline's words out`);
  }
  assert.equal(ISSUES.gap.words, "nothing in the API");
  assert.equal(ISSUES.tie.words, "two fields fit equally");
  assert.equal(ISSUES.ask.words, "waiting for you");
  assert.equal(ISSUES.stub.words, "placeholder to write");
  assert.equal(ISSUES.formInput.words, "form input the API lacks");
});

test("a future kind is one more entry: the badge and the form lookup pick it up", () => {
  ISSUES.coupled = { label: "Coupled", words: "moves with 3 others", color: "var(--tie)", icon: "tie", form: "info", team: "product", explain: "Changing this part also changes three others, so check them together." };
  try {
    assert.match(badgeHtml("coupled", { size: "m" }), /Coupled<span class="ibg-w"> · moves with 3 others/);
    assert.equal(formFor("coupled"), "info");
    assert.ok(issue("coupled"));
  } finally { delete ISSUES.coupled; }
  assert.equal(badgeHtml("nonsense"), "");
});

test("a skipped part shows as the Gap or Tie underneath, and says it is waiting", () => {
  assert.equal(underlying("ask", { origin: "tie" }), "tie");
  assert.equal(underlying("ask", { origin: "missing" }), "gap");
  assert.equal(underlying("stub"), "stub");
  const html = badgeHtml("ask", { size: "m", under: "tie" });
  assert.match(html, /ibg-tie/);
  assert.match(html, /ibg-waiting/);
  assert.match(html, /waiting for you/);
  const small = badgeHtml("ask", { size: "s", under: "gap" });
  assert.match(small, />Ask</, "an open Ask is an Ask, not a red Gap");
  assert.doesNotMatch(small, />Gap</);
  assert.match(small, /ibg-ask/);
  assert.equal((small.match(/class="ibg /g) ?? []).length, 1, "on the page it is one small badge");
  assert.match(badgeHtml("ask", { size: "m", under: "gap" }), /Ask<span class="ibg-w"> · waiting for you/);
  assert.equal((badgeHtml("ask", { size: "s", under: "tie" }).match(/class="ibg /g) ?? []).length, 1, "a small Tie badge stays one badge too");
});

test("classify reads the tree's own wording: Gap, Tie, Stub, Ask, no endpoint, form input", async () => {
  const cell = (state, title = "x") => ({ state, title, sub: "" });
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("ok"), cell("ok")] }), null);
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("static"), null] }), null);
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("missing", "no transform"), cell("missing")] }), "gap");
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("ask", "2 possible matches"), cell("ask")] }), "tie");
  assert.equal(classify({ id: "list.sort", cells: [cell("ok"), cell("ask", "no possible sorts"), cell("ask")] }), "gap");
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("placeholder", "x()"), cell("ok")] }), "stub");
  assert.equal(classify({ id: "value.a", cells: [cell("ok"), cell("ask", "skipped for now"), cell("ask")] }), "ask");
  assert.equal(classify({ id: "action.row.delete", cells: [cell("ok"), cell("ok", "delete"), cell("missing", "endpoint missing")] }), "noEndpoint");
  assert.equal(classify({ id: "form.name", cells: [cell("ok"), cell("missing", "no request field"), cell("missing")] }), "formInput");
  assert.equal(classify({ id: "form.name", cells: [cell("ok"), cell("ok"), cell("ok")] }), null);
  assert.equal(classify({ id: "form.missing.role", cells: [cell("missing"), cell("ok"), cell("ok")] }), "noInput");
  assert.equal(classify({ id: "gap.0", cells: [cell("missing", "gap")] }), "gap");
});

test("on the real examples every kind shows up where the pipeline says something is wrong", async () => {
  const inv = await computeState(fixture("invoices"));
  const kinds = Object.fromEntries(inv.parts.filter((p) => p.kind).map((p) => [p.id, p.kind]));
  assert.equal(Object.keys(kinds).length, inv.stats.needHuman, "one badge per part that needs a human");
  assert.equal(new Set(Object.values(kinds)).size, 1, "with nothing answered every one is an Ask");
  const under = Object.fromEntries(inv.parts.filter((p) => p.kind).map((p) => [p.id, underlying(p.kind, p.item)]));
  assert.equal(under["list.requestedBy"], "tie");
  assert.equal(under["list.status"], "gap");

  const ord = await computeState(fixture("orders"));
  assert.ok(ord.parts.some((p) => p.kind === "noEndpoint" || p.kind === "formInput" || p.kind), "orders has open parts");
  const kindsOrders = new Set(ord.parts.map((p) => p.kind).filter(Boolean));
  assert.ok([...kindsOrders].every((k) => KINDS.includes(k)));
});

test("a waiting button whose endpoint is missing is a No endpoint underneath", () => {
  assert.equal(underlying("ask", { id: "action.page.save", origin: "missing", why: `"save" looks like "save", but the API for it (create, update) wasn't given.` }), "noEndpoint");
  assert.equal(underlying("ask", { id: "action.row.archive", origin: "missing", why: `"archive" isn't a verb the tool knows` }), "gap");
  assert.equal(formFor("ask", { id: "action.page.save", why: "the API wasn't given" }), "which-endpoint");
});
