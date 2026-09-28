// The demo shell: its vocabulary, its routes, and the promise that the fine-grain words never reach its screens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import _parse from "@babel/parser";
import { runPipeline } from "../pipeline.mjs";
import { resetExample } from "../reset.mjs";
import { renderShell } from "../demo-server.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import {
  PRODUCT, PATTERN_SENTENCE, TERMS, STATE_TERM, ITEM_TERM, EVENT_TERM, BANNED, bannedIn, scrub, leafState, summarize, headline, breakdown, STATES, groupItems,
  askTitle, cleanEmail, plainOption, plainCandidate, plainTitle, waitingTitle, humanize, byLabel, itemTerm, TEAMS, TEAM_LABEL,
} from "./vocab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const parse = _parse.parse ?? _parse.default?.parse;

// ---------- the vocabulary ----------
test("every pattern word is defined once, with the pipeline term it replaces", () => {
  const words = Object.values(TERMS).map((t) => t.word);
  assert.deepEqual(words, ["Seam", "Fit", "Waiting", "Gap", "Tie", "Ask", "Stub", "Suggest", "Ledger", "Replay", "Handoff", "Fit report"]);
  const was = Object.fromEntries(Object.entries(TERMS).map(([k, t]) => [k, t.was]));
  assert.equal(was.fit, "connected");
  assert.equal(was.gap, "missing");
  assert.equal(was.wait, "unanswered question");
  assert.equal(was.ask, "question");
  assert.equal(was.stub, "placeholder");
  assert.equal(was.suggest, "AI answer");
  assert.equal(was.replay, "re-run");
  assert.equal(was.handoff, "team action");
  assert.equal(was.fitReport, "run summary");
  for (const t of Object.values(TERMS)) assert.ok(t.def.length > 10, `${t.word} has a definition`);
});

test("the product name is one constant and the word envelope is not a term", () => {
  assert.equal(PRODUCT.name, "Trace");
  assert.equal(PRODUCT.tagline, "Give Trace the design and the API. It wires the screen and tells each team what doesn't fit.");
  assert.match(PATTERN_SENTENCE, /^Trace finds the seams\. Each is a Fit, a Gap or a Tie\./);
  assert.ok(!Object.values(TERMS).some((t) => /envelope/i.test(t.word)));
});

test("pipeline states map onto Fit, Waiting, Gap, Tie and Stub", () => {
  assert.deepEqual(STATE_TERM, { ok: "fit", static: "fit", missing: "gap", ask: "tie", placeholder: "stub" });
  assert.deepEqual(ITEM_TERM, { missing: "gap", gap: "gap", tie: "tie", placeholder: "stub" });
  assert.equal(EVENT_TERM.question, "ask");
  assert.equal(EVENT_TERM.answered, "ledger");
  assert.equal(EVENT_TERM.actions, "handoff");
  assert.equal(EVENT_TERM.summary, "fitReport");
});

const cell = (state, title = "x", sub = "", extra = {}) => ({ state, title, sub, ...extra });
const OPEN = { waiting: true }; // what src/tree/model.mjs sets on a red cell whose Ask is open
const leaf = (id, ...cells) => ({ id, cells });

test("a part is a Fit, Waiting, Gap, Tie or Stub by its worst cell", () => {
  assert.equal(leafState(leaf("a", cell("ok"), cell("ok"))), "fit");
  assert.equal(leafState(leaf("a", cell("static"), null)), "fit");
  assert.equal(leafState(leaf("a", cell("missing"), cell("missing"))), "gap", "missing with no question to ask is a confirmed Gap");
  assert.equal(leafState(leaf("a", cell("placeholder"), cell("ok"))), "stub");
  assert.equal(leafState(leaf("a", cell("ask", "2 possible matches"), cell("ask"))), "tie");
  assert.equal(leafState(leaf("a", cell("ask", "no possible sorts"), cell("ask"))), "wait", "an open Ask is waiting, not a Gap");
  assert.equal(leafState(leaf("a", cell("ask", "what should it do?"), cell("ask"))), "wait");
  assert.equal(leafState(leaf("a", cell("ask", "2 possible matches"), cell("missing"))), "gap", "missing outranks ask");
});

test("a part the pipeline marks 'needs your answer' is Waiting until it is answered; answered 'not in the API yet' is a Gap", () => {
  const unanswered = leaf("list.status", cell("ok", "row.status"), cell("missing", "no transform", "nothing in the API gives this"), cell("missing", "not in API", "needs your answer", OPEN));
  assert.equal(leafState(unanswered), "wait");
  const answered = leaf("list.status", cell("ok", "row.status"), cell("missing", "no transform", "nothing in the API gives this"), cell("missing", "not in API", "TODO in generated code"));
  assert.equal(leafState(answered), "gap", "someone settled it: nothing behind it");
  const noContract = leaf("list.status", cell("ok"), cell("missing", "no transform", "no API contract"), cell("missing", "no API contract", "upload a Swagger/OpenAPI file"));
  assert.equal(leafState(noContract), "gap", "no question is possible without a contract");
  assert.equal(leafState(leaf("action.row.delete", cell("ok"), cell("ok", "delete"), cell("missing", "endpoint missing", "needs DELETE", OPEN))), "wait", "its Ask (what should the button do?) is still open");
  assert.equal(leafState(leaf("action.row.delete", cell("ok"), cell("ok", "delete"), cell("missing", "endpoint missing", "upload a Swagger/OpenAPI file"))), "gap", "no contract: no question to ask");
  assert.equal(leafState(leaf("form.notes", cell("ok"), cell("missing", "no request field", "no example body has it"), cell("missing", "not in API", "notes would be dropped"))), "gap", "an input the API lacks is settled by the contract, not by an answer");
});

test("a skipped part is still waiting (or a Tie); nothing turns it into a Gap but an answer", () => {
  const skipped = leaf("value.owner", cell("ask", "skipped for now"), cell("ask"));
  assert.equal(leafState(skipped), "wait", "nothing known: waiting for you");
  assert.equal(leafState(skipped, { prev: "tie" }), "tie", "it was a Tie before it was skipped");
  assert.equal(leafState(skipped, { items: { "value.owner": { state: "skipped", origin: "tie" } }, prev: "wait" }), "tie", "the open item wins");
  assert.equal(itemTerm({ state: "skipped", origin: "missing" }), "wait");
  assert.equal(itemTerm({ state: "skipped", origin: "tie" }), "tie");
  assert.equal(itemTerm({ state: "missing" }), "gap");
  assert.equal(itemTerm({ state: "placeholder" }), "stub");
});

test("the headline counts parts that fit, and names what is open: waiting for you first, then gaps, ties, stubs", () => {
  const tree = { groups: [{ leaves: [leaf("a", cell("ok")), leaf("b", cell("ok")), leaf("c", cell("missing")), leaf("d", cell("ask", "2 possible matches")), leaf("e", cell("placeholder")), leaf("f", cell("ask", "skipped for now")), leaf("g", cell("missing", "not in API", "needs your answer", OPEN))] }] };
  const s = summarize(tree);
  assert.deepEqual({ total: s.total, fit: s.fit, wait: s.wait, gap: s.gap, tie: s.tie, stub: s.stub, needHuman: s.needHuman }, { total: 7, fit: 2, wait: 2, gap: 1, tie: 1, stub: 1, needHuman: 5 });
  assert.equal(headline(s), "2 of 7 parts fit · 2 waiting for you · 1 gap · 1 tie · 1 stub");
  assert.equal(breakdown(s), "2 waiting for you · 1 Gap · 1 Tie · 1 Stub");
  assert.equal(headline({ total: 29, fit: 8, wait: 18, gap: 3, needHuman: 21 }), "8 of 29 parts fit · 18 waiting for you · 3 gaps");
  assert.equal(headline({ total: 4, fit: 3, wait: 1, needHuman: 1 }), "3 of 4 parts fit · 1 waiting for you");
  assert.equal(headline({ total: 4, fit: 3, needHuman: 1 }), "3 of 4 parts fit · 1 needs a human", "counts that predate Waiting still read");
  assert.equal(headline({ total: 4, fit: 4, needHuman: 0 }), "All 4 parts fit");
  assert.equal(headline(summarize({ groups: [] })), "");
  assert.deepEqual(STATES, ["fit", "wait", "gap", "tie", "stub"]);
  assert.deepEqual(bannedIn(headline(s) + breakdown(s) + Object.values(TERMS).map((t) => `${t.word} ${t.def} ${t.phrase ?? ""}`).join(" ")), []);
});

test("items with the same part and title are listed once with a count", () => {
  const a = { id: "action.page.suggest", title: '"suggest (page action)" has nothing behind it' }, b = { id: "list.maturity", title: "x" };
  assert.deepEqual(groupItems([a, b, { ...a }]).map((g) => [g.item.id, g.count]), [["action.page.suggest", 2], ["list.maturity", 1]], "order of the first of each");
  assert.deepEqual(groupItems([a, { ...a, title: "another" }]).map((g) => g.count), [1, 1], "a different title is a different item");
  assert.deepEqual(groupItems(null), []);
  assert.equal(groupItems([a, a, a]).reduce((n, g) => n + g.count, 0), 3, "nothing is dropped");
});

test("Asks are put in plain words, with concrete options", () => {
  const ctx = (label, candidates = []) => ({ label, candidates, design: [], available: [] });
  assert.deepEqual(askTitle({ id: "list.owner", context: ctx("row.owner", [{}, {}]) }), { kind: "tie", text: "Which field is *Owner*?" });
  assert.deepEqual(askTitle({ id: "list.owner", context: ctx("row.owner") }), { kind: "gap", text: "Nothing in the API gives *Owner*. What is it?" });
  assert.deepEqual(askTitle({ id: "list.savingsRangeRow", context: ctx("row.savingsRangeRow") }).text, "Nothing in the API gives *Savings range row*. What is it?");
  assert.equal(askTitle({ id: "list.sort", context: ctx("row order", [{}, {}]) }).text, "How should the rows be ordered?");
  assert.equal(askTitle({ id: "action.row.delete", text: `"delete" looks like "remove", but the API for it (remove) wasn't given. What should it do?`, context: ctx("delete (row button)") }).text, "The API can't do *delete* yet. What should the button do?");
  assert.equal(askTitle({ id: "action.row.archive", text: `What should the "archive" row action do?`, context: ctx("archive") }).text, "What should *archive* do?");
  const sub = askTitle({ id: "value.x#fn", sub: true, text: `What should the placeholder function for "syncedAt" be called?` });
  assert.equal(sub.kind, "stub");
  assert.equal(sub.text, "What should the Stub function for *syncedAt* be called?");
});

test("options and candidates lose the pipeline's words", () => {
  assert.equal(plainOption("data the API doesn't provide yet — leave a TODO"), "Not in the API yet, leave it as a Gap");
  assert.equal(plainOption("static text — not data"), "Just fixed text, not data");
  assert.equal(plainOption("something else — build a placeholder…"), "Something else, make it a Stub…");
  assert.equal(plainOption("combine values from API fields — placeholder function in the domain layer"), "Combine API fields (a Stub)");
  assert.equal(plainOption('API field "requester"'), "The field requester");
  assert.equal(plainOption('API field "amount" shown as moneyCompact'), "The field amount");
  assert.equal(plainOption('response field "meta.snapshot_date", shown as dateShort'), "The field meta.snapshot_date");
  assert.equal(plainOption("sum(value) of the list, shown as moneyCompact"), "The sum of value");
  assert.equal(plainCandidate("sum(value) · moneyCompact"), "sum of value");
  assert.equal(plainCandidate("requester · asText"), "requester");
  assert.equal(plainCandidate("field meta.snapshot_date · dateShort"), "meta.snapshot_date");
  assert.equal(plainTitle('"row.status" has nothing behind it in the API'), '"Status" has nothing behind it in the API');
  assert.equal(plainTitle('"delete (row action)" has nothing behind it in the API'), "The “delete” button has nothing behind it in the API");
  assert.equal(plainTitle('"suggest (page action)" has nothing behind it'), "The “suggest” button has nothing behind it", "a button called suggest is not a Suggest");
  assert.equal(plainTitle('The design and the contract disagree about "input notes"'), "The design and the contract disagree about the “notes” input");
  assert.equal(waitingTitle('"row.status" has nothing behind it in the API'), '"Status" is waiting for an answer', "an open Ask is not a defect");
  assert.equal(waitingTitle('"suggest (page action)" has nothing behind it in the API'), "The “suggest” button is waiting for an answer");
  assert.equal(waitingTitle('The design and the contract disagree about "input notes"'), plainTitle('The design and the contract disagree about "input notes"'), "other wording is left alone");
  assert.equal(humanize("row.spendChange"), "Spend change");
  assert.equal(byLabel("ai"), "Suggest");
  assert.equal(byLabel("saved"), "Saved earlier");
  assert.deepEqual(TEAMS.map((t) => TEAM_LABEL[t]), ["Backend", "Product", "Design", "Frontend"]);
});

test("a team email never shows the word undefined, and names this product", () => {
  const body = ["1. Status", "   Candidates: undefined · undefined → undefined, undefined", "   Why it matters: x", "", "(generated from the line-matcher run summary)"].join("\n");
  assert.equal(cleanEmail(body), ["1. Status", "   Why it matters: x", "", "(sent from Trace)"].join("\n"));
  assert.equal(cleanEmail(body.replace("line-matcher", "Trace")), ["1. Status", "   Why it matters: x", "", "(sent from Trace)"].join("\n"), "the studio's email footer names Trace too");
});

test("scrub rewrites the fine-grain words that slip through", () => {
  assert.equal(scrub("placeholder function in the domain layer"), "Stub function in the app");
  assert.equal(scrub("2 placeholders to build"), "2 Stubs to build");
  assert.equal(scrub("the layer of the transform and the formatter in the envelope"), "the area of the conversion and the format in the response");
  assert.deepEqual(bannedIn("The match tree, a layer and a formatter"), ["tree", "layer", "formatter"]);
  assert.deepEqual(bannedIn("Nothing to see, a street"), []);
  assert.ok(["transform", "tree", "layer", "formatter", "console"].every((w) => BANNED.includes(w)));
});

// ---------- the banned words never reach the demo path ----------
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const stringsOf = (file) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "StringLiteral") out.push(n.value);
    if (n.type === "TemplateElement") out.push(n.value.cooked ?? n.value.raw);
    for (const k of Object.keys(n)) if (k !== "loc" && k !== "start" && k !== "end") for (const c of [].concat(n[k])) if (c && typeof c.type === "string") walk(c);
  };
  walk(parse(fs.readFileSync(file, "utf8"), { sourceType: "module" }).program);
  return out;
};

test("the shell's page has none of the fine-grain words in its visible text", () => {
  const text = visibleText(renderShell());
  assert.ok(text.includes(PRODUCT.tagline));
  assert.deepEqual(bannedIn(text), []);
  for (const w of ["transform", "tree", "layer", "formatter", "console"]) assert.ok(!new RegExp(`\\b${w}`, "i").test(text), `visible text has "${w}"`);
  assert.ok(!/line-matcher/i.test(text));
});

test("none of the shell's own copy (strings in its scripts) uses them either", () => {
  for (const f of ["demo.mjs", "scenarios.mjs", "icons.mjs", "wire-delay.mjs", "thumb.mjs"]) {
    const bad = stringsOf(path.join(here, f)).flatMap((s) => bannedIn(s).map((w) => `${f}: "${w}" in ${JSON.stringify(s.slice(0, 60))}`));
    assert.deepEqual(bad, [], `${f} uses a banned word`);
  }
  for (const s of SCENARIOS) assert.deepEqual(bannedIn(`${s.title} ${s.tag} ${s.caption}`), []);
});

test("what the pipeline says about the three scenarios reaches the shell in demo words only", async () => {
  const seen = [];
  for (const s of SCENARIOS) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-test-"));
    const dir = path.join(tmp, s.example);
    fs.cpSync(path.join(root, "examples", s.example), dir, { recursive: true });
    resetExample(dir); // clean state and the original inputs, whatever an earlier take left in examples/
    let teams = [], items = [], tree = null;
    const asks = [];
    await runPipeline({
      dir, outRoot: path.join(tmp, "out"), useSaved: false,
      prompt: async () => ({ skip: true }),
      emit: (type, d) => { if (type === "question") asks.push(d); if (type === "actions") teams = d.teams; if (type === "items") items = d.items; if (type === "tree") tree = d.tree; },
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    assert.ok(asks.length > 0, `${s.id} asks something`);
    for (const q of asks) {
      seen.push(askTitle(q).text);
      for (const o of q.options ?? []) seen.push(plainOption(o));
      for (const c of q.context?.candidates ?? []) seen.push(plainCandidate(c.label), ...(c.samples ?? []));
    }
    for (const t of teams) for (const i of t.items) seen.push(plainTitle(i.title), scrub(t.email?.subject ?? ""));
    const sum = summarize(tree, { items: Object.fromEntries(items.map((i) => [i.id, i])) });
    seen.push(headline(sum), breakdown(sum));
    assert.equal(sum.total, s.expect.total, `${s.id} total`);
    assert.equal(sum.fit, s.expect.fit, `${s.id} fit with every Ask skipped`);
  }
  const bad = seen.flatMap((t) => bannedIn(t).map((w) => `"${w}" in ${JSON.stringify(t.slice(0, 80))}`));
  assert.deepEqual(bad, []);
});

// ---------- routes ----------
const JSON_H = { "content-type": "application/json" }; // the server refuses a state-changing request that is not JSON
function startServer(args = []) {
  return new Promise((resolve, reject) => {
    const port = 4600 + Math.floor(Math.random() * 300);
    const p = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--no-open", "--port", String(port), ...args], { cwd: root });
    let out = "";
    const t = setTimeout(() => { p.kill(); reject(new Error("server did not start: " + out)); }, 15000);
    p.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(t); resolve({ base: `http://localhost:${m[1]}`, stop: () => p.kill() }); }
    });
    p.stderr.on("data", (d) => (out += d));
  });
}

test("/ serves the demo shell and /studio the existing studio", async () => {
  const srv = await startServer();
  try {
    const home = await fetch(srv.base + "/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    const html = await home.text();
    assert.match(html, /<title>Trace<\/title>/);
    assert.match(html, /id="bWire"|id="s-drop"/);
    assert.ok(!html.includes("{{"), "no placeholder is left in the page");
    assert.ok(!html.includes('id="exsel"'), "the studio's controls are not on the demo path");

    const studio = await fetch(srv.base + "/studio");
    assert.equal(studio.status, 200);
    const s = await studio.text();
    assert.match(s, /<title>Trace · Studio<\/title>/);
    assert.ok(s.includes('id="exsel"') && s.includes('id="bStart"'), "the studio is intact");
    assert.ok(s.includes('href="/"'), "the studio links back to the demo");

    for (const f of ["demo.mjs", "demo.css", "demo-tokens.css", "vocab.mjs", "scenarios.mjs", "icons.mjs", "wire-delay.mjs", "thumb.mjs", "assets/trace-mark.svg", "assets/trace-favicon.svg"]) {
      assert.equal((await fetch(`${srv.base}/demo/${f}`)).status, 200, f);
    }
    assert.equal((await fetch(`${srv.base}/demo/nope.mjs`)).status, 404);
    assert.equal((await fetch(`${srv.base}/demo/..%2Fserver.mjs`)).status, 404, "only the allow-list is served");
    assert.equal((await fetch(`${srv.base}/demo/assets/..%2F..%2Fserver.mjs`)).status, 404);

    const status = await (await fetch(srv.base + "/api/demo/status")).json();
    assert.equal(typeof status.suggest, "boolean");
    assert.deepEqual(status.scenarios.map((x) => x.id), ["portfolio", "invoices", "orders"]);
    assert.ok(status.scenarios.every((x) => x.present));
    assert.equal((await fetch(srv.base + "/api/demo/apply-fix", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "invoices" }) })).status, 404, "only a scenario with a prepared fix can be fixed");
    assert.equal((await fetch(srv.base + "/api/demo/apply-fix", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "../x" }) })).status, 404);
  } finally { srv.stop(); }
});

test("Backend ships the fix, and Reset demo undoes it (on a scratch copy of the examples)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-fix-"));
  fs.cpSync(path.join(root, "examples", "orders"), path.join(tmp, "orders"), { recursive: true });
  resetExample(path.join(tmp, "orders"));
  const original = fs.readFileSync(path.join(tmp, "orders", "openapi.json"), "utf8");
  const srv = await startServer(["--examples", tmp, "--out", path.join(tmp, "out")]);
  try {
    const st = (await (await fetch(srv.base + "/api/demo/status")).json()).scenarios;
    assert.equal(st.find((x) => x.id === "orders").fixable, true);
    assert.equal(st.find((x) => x.id === "orders").fixed, false);
    assert.equal(st.find((x) => x.id === "portfolio").present, false, "a missing scenario is reported, not a crash");
    const r = await fetch(srv.base + "/api/demo/apply-fix", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "orders" }) });
    assert.equal(r.status, 200);
    assert.notEqual(fs.readFileSync(path.join(tmp, "orders", "openapi.json"), "utf8"), original);
    assert.equal((await (await fetch(srv.base + "/api/demo/status")).json()).scenarios.find((x) => x.id === "orders").fixed, true);
    const reset = await fetch(srv.base + "/api/reset", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "orders" }) });
    assert.equal(reset.status, 200);
    assert.equal(fs.readFileSync(path.join(tmp, "orders", "openapi.json"), "utf8"), original, "the original contract is back");
  } finally { srv.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("a run left waiting on an Ask (a closed tab) is released, so Reset is not blocked", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-release-"));
  fs.cpSync(path.join(root, "examples", "invoices"), path.join(tmp, "invoices"), { recursive: true });
  resetExample(path.join(tmp, "invoices"));
  const srv = await startServer(["--examples", tmp, "--out", path.join(tmp, "out")]);
  try {
    const { run } = await (await fetch(srv.base + "/api/run", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "invoices" }) })).json();
    assert.ok(run);
    await new Promise((r) => setTimeout(r, 1500)); // the run is now waiting on its first Ask
    const blocked = await fetch(srv.base + "/api/reset", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "invoices" }) });
    assert.equal(blocked.status, 409);
    const rel = await (await fetch(srv.base + "/api/demo/release", { method: "POST", headers: JSON_H })).json();
    assert.ok(rel.released >= 6, "every Ask of the run was skipped");
    assert.equal(rel.stillRunning, 0);
    const ok = await fetch(srv.base + "/api/reset", { method: "POST", headers: JSON_H, body: JSON.stringify({ example: "invoices" }) });
    assert.equal(ok.status, 200);
  } finally { srv.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("the preflight runs the three scenarios end to end and reports READY", () => {
  const r = spawnSync(process.execPath, [path.join(root, "src", "demo-check.mjs"), "--port", String(5100 + Math.floor(Math.random() * 300))], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /READY/);
  assert.match(r.stdout, /PASS\s+Run: Orders\s+11 of 15 parts fit/);
  assert.match(r.stdout, /PASS\s+Run after the fix: Orders\s+All 15 parts fit/);
});

test("Wire it stays in view: the drop screen's foot sticks to the bottom edge (above the key hints, or at 0 in Presenter mode)", () => {
  const css = fs.readFileSync(new URL("./demo.css", import.meta.url), "utf8");
  const rule = /#s-drop \.drop-foot \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /position:\s*sticky/);
  assert.match(rule, /bottom:\s*var\(--keys\)/);
  assert.match(rule, /background:\s*var\(--bg\)/, "opaque, so the content scrolls under it without showing through");
  assert.match(css, /html\[data-present="1"\] #s-drop \.drop-foot \{\s*bottom:\s*0;/, "the key hints are hidden in Presenter mode, so the foot goes to the edge");
});
