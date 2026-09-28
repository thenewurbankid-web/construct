#!/usr/bin/env node
// Real-browser check and screenshots of the Page map (headless Chrome over the DevTools protocol; no dependency).
//   node scripts/pagemap-shots.mjs [outDir]      default outDir: docs/pagemap
// It starts Trace on port 4300 with a scratch copy of the examples (so no decision file is ever written into the real ones),
// adds an "orders-plain" example (the orders page with its markers removed, to show what Trace proposes on an unmarked design),
// drives the page (select, accept, mark, bulk accept, undo, filters, tabs, keyboard, apply), takes the screenshots at 1440x900 in
// both themes, and FAILS (exit 1) on any console error, uncaught exception or failed expectation. Needs Google Chrome
// (set CHROME to its path when it is not in the macOS default place). Not part of `npm test`: it needs a browser.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "docs", "pagemap"));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4300, DEBUG = 9360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

// ---- scratch tree: examples + the Subframe pages, and orders-plain ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-pmshots-"));
fs.cpSync(path.join(root, "examples"), path.join(tmp, "examples"), { recursive: true });
fs.rmSync(path.join(tmp, "examples", ".original"), { recursive: true, force: true });
fs.cpSync(path.join(root, "subframe-app", "src", "pages"), path.join(tmp, "subframe-app", "src", "pages"), { recursive: true });
const plain = path.join(tmp, "examples", "orders-plain");
fs.cpSync(path.join(tmp, "examples", "orders"), plain, { recursive: true });
for (const f of ["answers.json", "decisions.json"]) fs.rmSync(path.join(plain, f), { force: true });
fs.writeFileSync(path.join(plain, "page.jsx"), fs.readFileSync(path.join(plain, "page.jsx"), "utf8").replace(/\s+data-(dyn|list|action)="[^"]*"/g, "").replace(/^\/\/.*\n/gm, "// Orders page with its data-* markers removed: what Trace proposes on an unmarked design.\n"));

const server = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--port", String(PORT), "--strict-port", "--no-open", "--examples", path.join(tmp, "examples"), "--out", path.join(tmp, "out")], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(tmp, "chrome")}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { server.kill(); chrome.kill(); fs.rmSync(tmp, { recursive: true, force: true }); };
process.on("exit", cleanup);

let tabs;
for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); if (tabs.length) break; } catch {} await sleep(250); }
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.exceptionThrown") problems.push("exception: " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") problems.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") problems.push("log: " + d.params.entry.text + " " + (d.params.entry.url ?? ""));
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); }
};
const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) { problems.push("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return null; } return r.result?.value; };
const expect = (cond, what) => { if (!cond) problems.push("expected: " + what); else console.log("  ok", what); };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const f = path.join(out, `${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, "base64")); console.log("  shot", name, Math.round(fs.statSync(f).size / 1024) + " KB"); };
const key = (k, code) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: code }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code }));
const open = async (url, theme) => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await send("Page.navigate", { url }); await sleep(500);
  await ev(`try{localStorage.setItem('lm-theme','${theme}')}catch(e){}`);
  await send("Page.navigate", { url }); await sleep(1800);
};
const clickRow = (text) => ev(`(()=>{const r=[...document.querySelectorAll('#tree .pm-row')].find(r=>r.textContent.includes(${JSON.stringify(text)})); if(!r) return false; r.click(); return true})()`);
const T = (s) => ev(`document.querySelector(${JSON.stringify(s)})?.textContent?.replace(/\\s+/g,' ').trim()`);

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const base = `http://localhost:${PORT}/pagemap`;

console.log("JSX example (orders-plain), light");
await open(`${base}?example=orders-plain`, "light");
expect(/13 proposed edits/.test(await T("#props")), "orders-plain shows 13 proposed edits");
expect((await ev(`document.querySelectorAll('#tree .pm-row').length`)) > 20, "the structure has rows");
expect(await clickRow("Northwind"), "a text row can be clicked");
expect(/Dynamic value/.test(await T("#panel h2")), "the panel shows the proposal");
expect((await ev(`document.querySelectorAll('#panel .pm-diff .d.add').length`)) >= 1, "the panel shows the proposed diff");
// keyboard: arrow down then Enter selects the next row
await ev(`document.querySelector('#tree .pm-row.sel').focus()`); await key("ArrowDown", 40); await key("Enter", 13); await sleep(300);
expect(/1,200/.test((await ev(`document.querySelector('#tree .pm-row.sel')?.textContent`)) ?? ""), "ArrowDown then Enter selects the next node");
await clickRow("Northwind"); await sleep(200);
await shot("jsx-orders-light");

console.log("actions");
await ev(`document.querySelector('#panel [data-act="accept"]').click()`); await sleep(500);
expect((await ev(`fetch('/api/pagemap?example=orders-plain').then(r=>r.json()).then(j=>j.summary.decided)`)) === 1, "Accept records one decision");
await clickRow("orders · total value"); await sleep(200);
await ev(`document.querySelector('#panel [data-act="mark"][data-cls="dynamic"]').click()`); await sleep(500);
expect(/Marked as dynamic value/.test(await T("#msg")), "a node without a proposal can be marked");
await ev(`document.querySelector('[data-act="accept-strong"]').click()`); await sleep(700);
expect(/Accept all strong \(0\)/.test(await T("#props")), "bulk accept leaves no strong proposal waiting");
await ev(`document.querySelector('#bUndo').click()`); await sleep(500);
expect(!/Accept all strong \(0\)/.test(await T("#props")), "Undo takes the bulk back");
await ev(`document.querySelector('#bRedo').click()`); await sleep(500);
await ev(`(()=>{const s=document.querySelector('#fClass'); s.value='action'; s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(300);
expect((await ev(`document.querySelectorAll('#tree .pm-row').length`)) < 30, "the class filter narrows the tree");
await ev(`(()=>{const s=document.querySelector('#fClass'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
expect(await ev(`(()=>{const d=document.querySelector('#wire').contentDocument; const el=[...d.querySelectorAll('.pm-t')].find(e=>e.textContent==='Kestrel'); el.click(); return /Northwind/.test(document.querySelector('#panel .pm-quote')?.textContent ?? '')})()`), "a click in the wireframe selects the node (an instance selects its template)");
await ev(`document.querySelector('[data-act="apply"]').click()`); await sleep(900);
expect(await ev(`document.querySelector('#applyDlg').open`), "Apply opens the marked-copy dialog");
expect(/Use as the page/.test(await T("#applyBody")) && (await ev(`document.querySelector('#useBtn').disabled`)), "the second step is disabled until confirmed");
await shot("apply-dialog-light");
await ev(`document.querySelector('#applyDlg').close()`);

console.log("JSX example (orders-plain), dark, with the strong proposals accepted");
await open(`${base}?example=orders-plain`, "dark");
await clickRow("Northwind"); await sleep(300);
await shot("jsx-orders-dark");

console.log("a real Subframe page, light");
await open(`${base}?file=PortfolioHealthFigmaRebuild.tsx`, "light");
expect(/562 nodes/.test(await T("#covText")) && /100% accounted for/.test(await T("#covText")), "the coverage says 562 nodes, 100% accounted for");
expect(await ev(`!document.querySelector('#tabOrig') || document.querySelector('#tabOrig').hidden`), "a real page has no original preview tab");
expect(await clickRow("Declining:"), "a sentence with a number can be selected");
await sleep(300);
await shot("subframe-light");
await ev(`document.querySelector('#tabReview').click()`); await sleep(300);
expect((await ev(`document.querySelectorAll('#review .pm-rv').length`)) > 10, "the review list shows the proposals");
await shot("subframe-review-light");
await ev(`document.querySelector('#tabFlow').click()`); await sleep(400);
expect((await ev(`document.querySelectorAll('#flow .pm-res').length`)) >= 10, "States & flows lists the interactions with their resolution");
expect(/Requirement items/.test(await T("#flow")), "States & flows lists the requirement items");
await shot("subframe-flow-light");

console.log("a real Subframe page, dark");
await open(`${base}?file=PortfolioHealthFigmaRebuild.tsx`, "dark");
expect(await clickRow("“M”"), "an unsure node can be selected");
await sleep(300);
expect(/Ambiguous/.test(await T("#panel .pm-fix")), "the Fix area shows the registry's Ambiguous kind");
await shot("subframe-dark");
await ev(`document.querySelector('#tabSource').click()`); await sleep(400);
expect((await ev(`document.querySelectorAll('#source .pm-ln.hl').length`)) >= 1, "the source tab highlights the selected node");
await shot("subframe-source-dark");

// ---- the orphan UI: positional ids, a shifted page, a damaged sidecar ----
const sidecar = path.join(plain, "pagemap.json");
const pagePath = path.join(plain, "page.jsx");
fs.rmSync(sidecar, { force: true }); fs.rmSync(path.join(plain, "pagemap.history.jsonl"), { force: true });
for (const theme of ["light", "dark"]) {
  console.log(`orphans, ${theme}`);
  const original = fs.readFileSync(pagePath, "utf8").replace(/^\n+/, "");
  fs.writeFileSync(pagePath, original); fs.rmSync(sidecar, { force: true });
  await open(`${base}?example=orders-plain`, theme);
  await clickRow("Northwind"); await sleep(200);
  await ev(`document.querySelector('#panel [data-act="accept"]').click()`); await sleep(500);
  expect((await ev(`fetch('/api/pagemap?example=orders-plain').then(r=>r.json()).then(j=>j.summary.decided)`)) === 1, "one decision is made");
  // an edit that moves the lines (a blank line at the top), and a damaged entry in the sidecar
  fs.writeFileSync(pagePath, "\n" + original);
  const side = JSON.parse(fs.readFileSync(sidecar, "utf8"));
  side.decisions.n0badbad00 = null;
  fs.writeFileSync(sidecar, JSON.stringify(side));
  await open(`${base}?example=orders-plain`, theme);
  expect(/1 orphaned decision/.test(await T("#props")), "the summary line counts the orphaned decision");
  expect(await ev(`!document.querySelector('#warn').hidden`) && /ignored/.test(await T("#warn")), "the warning about the damaged entry is displayed");
  await ev(`document.querySelector('.pm-help summary').click()`);
  expect(await ev(`document.querySelector('.pm-help').open`) && /positional/.test(await T(".pm-help")), "the help box says ids are positional");
  await ev(`document.querySelector('#tabFlow').click()`); await sleep(400);
  expect(/Orphaned decisions \(1\)/.test(await T("#flow")) && (await ev(`!!document.querySelector('#flow [data-act="clear"]')`)), "the orphan is listed with a Drop control");
  await shot(`orphans-${theme}`);
  await ev(`document.querySelector('#flow [data-act="clear"]').click()`); await sleep(600);
  expect(!/orphaned decision/.test(await T("#props")), "Drop removes the orphan");
}
fs.writeFileSync(pagePath, fs.readFileSync(pagePath, "utf8").replace(/^\n+/, ""));

for (const [file, name] of [["PortfolioHealthFigmaRebuild2.tsx", "subframe2"], ["RedesignedPortfolioHealth.tsx", "redesigned"]]) {
  for (const theme of ["light", "dark"]) {
    console.log(`${file}, ${theme}`);
    await open(`${base}?file=${file}`, theme);
    expect(/100% accounted for/.test(await T("#covText")) && /tracked violations/.test(await T("#props")), `${file} loads (${theme}) with coverage and tracked violations`);
    expect(await ev(`fetch('/api/pagemap?file=${file}').then(r=>r.status)`) === 200, `${file}: the route answers 200`);
    await ev(`document.querySelector('#tree .pm-row .pm-dot.cls-dynamic')?.closest('.pm-row').click()`); await sleep(300);
    await shot(`${name}-${theme}`);
  }
}
ws.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "no console errors, all expectations met");
cleanup();
process.exit(problems.length ? 1 : 0);
