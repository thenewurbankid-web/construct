// The Page map's routes, kept out of server.mjs so that file only gains one line of wiring (like the inspector's).
//   GET  /pagemap                      the review page (src/ui/pagemap.html); /pagemap/pagemap.mjs and .css are its own files (an allow-list)
//   GET  /api/pagemap/pages            the examples and real Subframe pages that can be opened
//   GET  /api/pagemap?example=|file=   the whole map of one page: nodes, collapsed view, proposals, decisions, coverage, diffs, wireframe
//   POST /api/pagemap/decide           { example|file, changes:[{id, act, cls?, name?}] | bulk:"accept-strong" }   records decisions (sidecar + history)
//   POST /api/pagemap/undo | redo      { example|file }                                                           of the newest change (with its group)
//   POST /api/pagemap/apply            { example|file }                                                           writes the marked copy next to the source; never the page
//   POST /api/pagemap/use              { example, confirm:true }                                                  second step: the marked copy becomes the page (backup kept)
// Every request has already passed src/http-guard.mjs (Host, Origin, JSON content type) before it gets here; bodies are read
// only through the guard's reader (bad JSON 400, over 2 MB 413). `example` must be a known example and `file` one of the fixed
// real pages, so no request can name a path; every output file name is fixed (see docs/PAGEMAP.md). No model is ever called.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePage, analyse, payload, decide, stepHistory, applyToCopy, useAsPage, listPages, PagemapError } from "./pagemap/service.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(here, "ui");
const TYPES = { ".mjs": "text/javascript", ".css": "text/css" };
const ASSETS = { "pagemap.mjs": path.join(ui, "pagemap.mjs"), "pagemap.css": path.join(ui, "pagemap.css") };

export function createPagemapRoutes({ examplesDir, pagesDir = path.join(examplesDir, "..", "subframe-app", "src", "pages") }) {
  const env = { examplesDir, pagesDir };
  const fail = (json, res, e) => {
    if (!(e instanceof PagemapError)) throw e;
    json(res, e.status, { error: e.message, ...(e.id ? { id: e.id } : {}), ...(e.skipped ? { skipped: e.skipped.length } : {}) });
    return true;
  };
  return async function route(req, res, url, { readBody, json, file }) {
    const p = url.pathname;
    if (p === "/pagemap") { file(res, path.join(ui, "pagemap.html"), "text/html; charset=utf-8"); return true; }
    const asset = p.match(/^\/pagemap\/([\w.-]+)$/);
    if (asset) {
      if (Object.hasOwn(ASSETS, asset[1])) file(res, ASSETS[asset[1]], TYPES[path.extname(asset[1])]);
      else res.writeHead(404).end("not found");
      return true;
    }
    if (p !== "/api/pagemap" && !p.startsWith("/api/pagemap/")) return false;
    const post = req.method === "POST";
    try {
      if (p === "/api/pagemap/pages" && !post) return json(res, 200, listPages(env)), true;
      if (p === "/api/pagemap" && !post) {
        const q = url.searchParams;
        return json(res, 200, payload(analyse(resolvePage(env, { example: q.get("example"), file: q.get("file") })))), true;
      }
      if (!post || !["/api/pagemap/decide", "/api/pagemap/undo", "/api/pagemap/redo", "/api/pagemap/apply", "/api/pagemap/use"].includes(p)) return false;
      const body = await readBody(req); // the guard's reader: bad JSON is a 400, an oversized body a 413
      const a = analyse(resolvePage(env, { example: body.example, file: body.file }));
      if (p === "/api/pagemap/decide") { decide(a, body); return json(res, 200, payload(a)), true; }
      if (p === "/api/pagemap/undo" || p === "/api/pagemap/redo") { stepHistory(a, p.endsWith("undo") ? "undo" : "redo"); return json(res, 200, payload(a)), true; }
      if (p === "/api/pagemap/apply") { const r = applyToCopy(a); return json(res, 200, { ...r, map: payload(a) }), true; }
      if (body.confirm !== true) return json(res, 400, { error: "Replacing the page needs confirm: true (a second, explicit step)." }), true;
      const r = useAsPage(a);
      return json(res, 200, { ...r, map: payload(analyse(resolvePage(env, { example: body.example })) ) }), true;
    } catch (e) {
      return fail(json, res, e);
    }
  };
}
