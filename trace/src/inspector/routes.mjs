// The Part inspector's routes, kept out of server.mjs so that file only gains one line of wiring.
//   GET  /api/parts?example=          every part with its state and issue kind, and what Undo / Redo would do
//   GET  /api/part?example=&id=       one part: options with proof, API source, generated code, history
//   POST /api/part-preview            { example, changes:[{id, choice}] }  what the change would do, nothing written
//   POST /api/part-similar            { example, id, choice }              other parts the same choice fits
//   POST /api/part-apply              { example, changes:[{id, choice}], source?, suggest? }  writes answers.json + history
//   POST /api/part-undo | part-redo   { example, id? }                     of one part, or of the newest change
//   POST /api/suggest                 { example, id }                      one checked AI call for this part
//   POST /api/part-chat               { example, id, question, history? }  scoped streaming chat (server-sent events)
//   GET  /inspector/<file>            the inspector's own scripts and styles (an allow-list)
// The only files these write are answers.json and answers.history.jsonl of the chosen example.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig, taskConfig } from "../ai/config.mjs";
import { streamChat } from "../ai/provider.mjs";
import { computeState } from "./state.mjs";
import { underlying } from "../ui/issues.mjs";
import { inspectPart, resolveChoice, similarParts, titleOf } from "./inspect.mjs";
import { previewChanges } from "./preview.mjs";
import { applyChanges, undo, redo, summary } from "./history.mjs";
import { suggestFor } from "./suggest.mjs";
import { factsSheet, inScope, systemFor, chatMessages, parseReply, checkReply, REFUSAL } from "./chat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(here, "..", "ui");
const TYPES = { ".mjs": "text/javascript", ".css": "text/css" };
const ASSETS = { "issues.mjs": path.join(ui, "issues.mjs"), "inspector.mjs": path.join(ui, "inspector", "inspector.mjs"), "inspector.css": path.join(ui, "inspector", "inspector.css"), "chat.mjs": path.join(ui, "inspector", "chat.mjs"), "studio.mjs": path.join(ui, "inspector", "studio.mjs") };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const FRIENDLY = /fetch failed|ECONNREFUSED|aborted due to timeout/;

export function createInspectorRoutes({ examplesDir, outRoot, aiProvider = null, chatConfig = null, scratchRoot }) {
  const known = (name) => typeof name === "string" && /^[\w.-]+$/.test(name) && !/^\.+$/.test(name) && fs.existsSync(path.join(examplesDir, name, "feature.json"));
  const dirOf = (name) => path.join(examplesDir, name);

  // choices -> [{ id, value }] or an error, checked against the rule-computed options
  async function resolveAll(dir, list) {
    const st = await computeState(dir);
    const changes = [], checks = {};
    for (const c of list ?? []) {
      const r = resolveChoice(st, c.id, c.choice);
      if (r.error) return { error: r.error, id: c.id, unverified: !!r.unverified, rows: r.rows ?? null };
      changes.push({ id: c.id, value: r.value });
      if (r.check) checks[c.id] = r.check;
    }
    return { st, changes, checks };
  }

  return async function route(req, res, url, { readBody, json, file }) {
    const p = url.pathname;
    const asset = p.match(/^\/inspector\/([\w.-]+)$/);
    if (asset) {
      if (ASSETS[asset[1]]) file(res, ASSETS[asset[1]], TYPES[path.extname(asset[1])]);
      else res.writeHead(404).end("not found");
      return true;
    }
    if (!p.startsWith("/api/part") && p !== "/api/suggest") return false;
    const q = url.searchParams;
    const post = req.method === "POST";
    // readBody is the guard's reader: bad JSON is a 400, an oversized body a 413 (HttpError, mapped by the server), never swallowed here
    const body = post ? await readBody(req) : {};
    const example = post ? body.example : q.get("example");
    if (!known(example)) return json(res, 404, { error: "That example does not exist." }), true;
    const dir = dirOf(example);

    try {
      if (p === "/api/parts" && !post) {
        const st = await computeState(dir);
        const h = summary(dir);
        return json(res, 200, { parts: st.parts.map((x) => ({ id: x.id, title: titleOf(x), term: x.term, kind: x.kind, under: x.kind ? underlying(x.kind, x.item) : null, edited: h.edited.includes(x.id) })), stats: st.stats, history: { undo: h.undo, redo: h.redo } }), true;
      }
      if (p === "/api/part" && !post) {
        const r = await inspectPart({ dir, outRoot, id: q.get("id") ?? "" });
        if (!r) return json(res, 404, { error: "That part is not on this screen." }), true;
        return json(res, 200, { ...r, undo: summary(dir).undo, redo: summary(dir).redo }), true;
      }
      if (p === "/api/part-preview" && post) {
        const r = await resolveAll(dir, body.changes);
        if (r.error) return json(res, 422, r), true;
        return json(res, 200, { ...(await previewChanges({ dir, changes: r.changes, scratchRoot })), checks: r.checks }), true;
      }
      if (p === "/api/part-similar" && post) {
        const st = await computeState(dir);
        return json(res, 200, { similar: similarParts(st, body.id, body.choice) }), true;
      }
      if (p === "/api/part-apply" && post) {
        if (!Array.isArray(body.changes) || !body.changes.length) return json(res, 400, { error: "Nothing to apply." }), true;
        const r = await resolveAll(dir, body.changes);
        if (r.error) return json(res, 422, r), true;
        const s = body.suggest && body.suggest.fact ? { source: "inspector+suggest", model: String(body.suggest.model ?? "").slice(0, 80) || null, fact: String(body.suggest.fact).slice(0, 300) } : { source: "inspector" };
        const out = applyChanges(dir, r.changes, s);
        return json(res, 200, { ok: true, applied: out.entries.map((e) => ({ id: e.id, n: e.n })), history: summary(dir) }), true;
      }
      if ((p === "/api/part-undo" || p === "/api/part-redo") && post) {
        const r = (p === "/api/part-undo" ? undo : redo)(dir, body.id ?? null);
        if (r.error) return json(res, r.conflict ? 409 : 422, { error: r.error }), true;
        return json(res, 200, { ok: true, ids: r.ids, history: summary(dir) }), true;
      }
      if (p === "/api/suggest" && post) {
        const overrides = { tasks: isObj(body.ai?.tasks) ? body.ai.tasks : {} }; // untrusted: loadAiConfig keeps only a model name per task
        return json(res, 200, await suggestFor({ dir, id: String(body.id ?? ""), provider: aiProvider, overrides })), true;
      }
      if (p === "/api/part-chat" && post) return await chat(req, res, body, dir, example, json), true;
    } catch (err) {
      json(res, 500, { error: `Something went wrong reading this part: ${err.message}` });
      return true;
    }
    return false;
  };

  // Server-sent events like /api/mail-chat: start, thinking, text, done | error. Closing the connection stops the model.
  async function chat(req, res, body, dir, example, json) {
    const question = String(body.question ?? "").trim();
    if (!question) return json(res, 400, { error: "Ask something about this part." });
    const insp = await inspectPart({ dir, outRoot, id: String(body.id ?? "") });
    if (!insp) return json(res, 404, { error: "That part is not on this screen." });
    const c = chatConfig ?? taskConfig(loadAiConfig({ dir, overrides: { tasks: isObj(body.ai?.tasks) ? body.ai.tasks : {} } }), "part-chat");
    const model = `${c.provider}:${c.model ?? "fake"}`;
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = (type, data = {}) => res.writableEnded || res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    send("start", { model });
    const sheet = factsSheet(insp);
    if (!inScope(question, insp)) {
      send("done", { model, refused: true, text: REFUSAL, proposed: null, check: { ok: true, flagged: [] }, ms: 0 });
      return res.end();
    }
    const t0 = Date.now();
    let text = "", usage = null;
    try {
      for await (const e of streamChat({ ...c, system: systemFor(sheet), messages: chatMessages({ history: body.history, question }), signal: ac.signal })) {
        if (e.type === "usage") usage = e;
        else { if (e.type === "text") text += e.delta; send(e.type, { delta: e.delta }); }
      }
      const r = parseReply(text, insp.options.length);
      const refused = r.text.replace(/[.\s]+$/, "") === REFUSAL.replace(/\.$/, "");
      send("done", { model, refused, text: r.text, proposed: refused ? null : r.proposed, check: refused ? { ok: true, flagged: [] } : checkReply({ sheet, question, reply: r.text, optionCount: insp.options.length }), ms: Date.now() - t0, tokens: usage ? { in: usage.in, out: usage.out } : null });
    } catch (err) {
      if (!ac.signal.aborted) send("error", { message: FRIENDLY.test(err.message) ? "The AI helper is not reachable right now. Everything else on this screen still works." : err.message });
    }
    return res.end();
  }
}
