import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { modeOf, mailMessages, parseReply, tidy, factsOf, checkDraft, QUICK } from "./mail-chat.mjs";
import { streamChat, thinkSplitter } from "./provider.mjs";

const EMAIL = { subject: "[invoices] Frontend: 2 action items", body: 'Hi team,\n\n1. "row.status" is a stub\n   API: GET /api/invoices\n\n2. "syncedAt" is a stub\n   What we need: 3 fields by 26 Sep\n\nThanks,' };

test("mode is a fixed rule: questions are answered, everything else is an edit", () => {
  for (const q of ["Why is this for frontend?", "what does item 2 mean", "explain item 1"]) assert.equal(modeOf(q), "ask", q);
  for (const e of ["Make it shorter", "Friendlier tone please", "Do it in bullets", "Add a deadline of Friday"]) assert.equal(modeOf(e), "edit", e);
  for (const [, text] of QUICK) assert.equal(modeOf(text), "edit", text);
});

test("the prompt holds the current email, the request and only the last three earlier requests", () => {
  const [m] = mailMessages({ ...EMAIL, instruction: "Make it shorter", earlier: ["a", "b", "c", "d"] });
  assert.match(m.content, /Subject: \[invoices\]/);
  assert.match(m.content, /REQUEST: Make it shorter/);
  assert.doesNotMatch(m.content, /1\. a\b/);
  assert.match(m.content, /1\. b[\s\S]*3\. d/);
});

test("an edit reply is parsed into subject and body; text before the Subject line is dropped", () => {
  assert.deepEqual(parseReply("Sure! Here you go:\nSubject: New\n\nHi\nBye\n"), { note: "", subject: "New", body: "Hi\nBye" });
  assert.deepEqual(parseReply("```\nSubject: S\n\nBody\n```"), { note: "", subject: "S", body: "Body" });
  assert.equal(parseReply("just a body").subject, null);
  assert.equal(parseReply("just a body").body, "just a body");
  assert.deepEqual(parseReply("An answer.", "ask"), { note: "An answer.", subject: null, body: null });
  assert.equal(parseReply("Subject: only").body, null); // a partial stream has no body yet
});

test("tidy collapses a looping model's separators and trailing blanks", () => {
  assert.equal(tidy("a\n\n\nb\n\n---\n\n---\n---\n---\n"), "a\n\nb");
  assert.equal(tidy("x\n---\ny\n---\n---\n"), "x\n---\ny");
});

test("facts are names, endpoints, numbers and weekdays, not ordinary words", () => {
  const f = factsOf('Make "row.status" GET /api/x syncedAt 3 items by Friday, may be 12.5%. Please fix it.');
  for (const k of ['"row.status"', "get", "syncedat", "3", "friday", "12.5"]) assert.ok(f.has(k), k);
  for (const k of ["please", "make", "fix", "items"]) assert.ok(!f.has(k), k);
});

test("a draft may not add facts; leaving them out is reported, and mostly-empty or huge drafts are flagged", () => {
  const from = `${EMAIL.subject}\n${EMAIL.body}\nMake it shorter`;
  const same = checkDraft({ from, draft: `${EMAIL.subject}\n${EMAIL.body}`, baseLines: 8 });
  assert.equal(same.ok, true); assert.equal(same.lossy, false);
  const inv = checkDraft({ from, draft: `${EMAIL.subject}\n${EMAIL.body}\nPlease reply by Friday, ticket JIRA-123.`, baseLines: 8 });
  assert.equal(inv.ok, false); assert.deepEqual(inv.invented.sort(), ["friday", "jira-123"]);
  const lossy = checkDraft({ from, draft: `${EMAIL.subject}\nHi, please fix "row.status" when you can, thanks a lot.`, baseLines: 8 });
  assert.equal(lossy.ok, true); assert.equal(lossy.lossy, true); assert.ok(lossy.dropped.includes('"syncedat"'));
  assert.equal(checkDraft({ from, draft: "x\n".repeat(60) + "y".repeat(40), baseLines: 8 }).bloated, true);
  assert.equal(checkDraft({ from, draft: "ok", baseLines: 8 }).ok, false);
});

test("the think splitter separates <think> even when a tag is cut between chunks", () => {
  const split = thinkSplitter(), out = [];
  for (const c of ["Hello <thi", "nk>plan ", "it</th", "ink> world"]) out.push(...split(c));
  out.push(...split.flush());
  const join = (t) => out.filter((e) => e.type === t).map((e) => e.delta).join("");
  assert.equal(join("thinking"), "plan it");
  assert.equal(join("text"), "Hello  world");
});

test("streamChat streams from a fake provider and reports usage", async () => {
  const seen = [];
  for await (const e of streamChat({ provider: "fake", fn: () => "<think>hm</think>Subject: A\n\nB", system: "s", messages: [{ role: "user", content: "u" }] })) seen.push(e);
  assert.equal(seen.filter((e) => e.type === "thinking").map((e) => e.delta).join(""), "hm");
  assert.equal(seen.filter((e) => e.type === "text").map((e) => e.delta).join(""), "Subject: A\n\nB");
  assert.equal(seen.at(-1).type, "usage");
});

test("an Ollama stream is read line by line with its thinking field, and aborting closes the connection", async () => {
  let closedEarly = false;
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { thinking: "let me see" } }) + "\n");
    res.write(JSON.stringify({ message: { content: "Subject: " } }) + "\n");
    res.write(JSON.stringify({ message: { content: "Hi" } }) + "\n");
    if (req.url.includes("/slow")) { res.on("close", () => (closedEarly = true)); return; } // never finishes
    res.end(JSON.stringify({ done: true, prompt_eval_count: 7, eval_count: 3 }) + "\n");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const got = [];
    for await (const e of streamChat({ provider: "ollama", model: "m", baseUrl: base, system: "s", messages: [{ role: "user", content: "u" }] })) got.push(e);
    assert.deepEqual(got.map((e) => e.type), ["thinking", "text", "text", "usage"]);
    assert.deepEqual([got.at(-1).in, got.at(-1).out], [7, 3]);

    const ac = new AbortController(), seen = [];
    await assert.rejects(async () => {
      for await (const e of streamChat({ provider: "ollama", model: "m", baseUrl: base + "/slow", system: "s", messages: [{ role: "user", content: "u" }], signal: ac.signal })) { seen.push(e); if (seen.length === 3) ac.abort(); }
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closedEarly, true, "the model side was told to stop");
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

test("streaming refuses a provider that cannot write text", async () => {
  await assert.rejects(async () => { for await (const _ of streamChat({ provider: "jev", system: "s", messages: [] })); }, /single-choice/);
});
