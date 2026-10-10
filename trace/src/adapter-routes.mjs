// The HTTP side of adapter creation (LIN-90 §5, docs/ADAPTER-PERSISTENCE.md):
//   GET  /api/adapter?example=<name>&operation=<id>&field=<name>   one saved mapping, or { adapter: null }
//   GET  /api/adapter?example=<name>                               every saved mapping for the example, as
//                                                                    { adapters: { [operationId]: { [field]: mapping } } }
//                                                                    — LIN-117 §7's persistent "⇄ adapter" chip
//                                                                    reads this once per run to know which
//                                                                    endpoints have one, without a lookup per field.
//   POST /api/adapter   body { example, operationId, field, transform, params?, fromType, toType, value?, questionId?, run? }:
//                        validates the transform against the closed set (adapter.mjs), saves it runtime-only
//                        keyed by operationId + field (adapter-store.mjs; never touches the contract file).
//                        `questionId` (which Ask/Tie this attaches, if any) is accepted but never persisted
//                        into the mapping itself — a run-state-only id per docs/ADAPTER-PERSISTENCE.md's
//                        2026-09-30 design constraint, so the same mapping reads the same way whether it lives
//                        in run state or (later) in the contract as an x-trace-adapter extension.
//                        LIN-190: when `run` and `questionId` are both given, this also resolves that run's
//                        open question with an adapter-sourced answer (deps.resolveRun, server.mjs), the same
//                        one action the design calls for ("Save adapter & attach"). `run`/`questionId` stay
//                        run-state only, same as above — never part of the saved mapping.
//                        -> { ok: true, adapter, resolved }, or { error } (400 unknown transform / bad params)
// Security: server.mjs calls checkRequest (Host, Origin, content-type) BEFORE this route is dispatched, and
// hands it `readBody` (the guard's bounded JSON reader); this file never reads `req` itself.
import path from "node:path";
import { getAdapterFor, saveAdapterFor, loadAdapters } from "./adapter-store.mjs";
import { transformKindsFor, previewTransform } from "./ui/canvas/adapter.mjs";

const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

/**
 * Handle `GET /api/adapter` and `POST /api/adapter`. Security is checked by the caller before this is
 * dispatched, matching contract-routes.mjs's own boundary.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url
 * @param {{examplesDir: string, known: (name: string) => boolean,
 *   readBody: (req: object, opts?: {limit: number}) => Promise<object>,
 *   resolveRun?: (runId: string, mapping: {operationId: string, field: string, transform: string, params: object, fn?: string}) => boolean}} deps
 *   `resolveRun` (LIN-190, server.mjs) answers that run's open question with the mapping; returns whether a
 *   question was actually waiting to answer.
 * @returns {Promise<boolean>} `true` when this route handled the request.
 */
export async function adapterRoute(req, res, url, { examplesDir, known, readBody, resolveRun }) {
  const p = url.pathname;
  if (p !== "/api/adapter") return false;

  if (req.method === "GET") {
    const name = url.searchParams.get("example");
    if (!known(name)) { send(res, 404, { error: "unknown example" }); return true; }
    const operationId = url.searchParams.get("operation");
    const field = url.searchParams.get("field");
    if (!operationId && !field) { send(res, 200, { adapters: loadAdapters(path.join(examplesDir, name)) }); return true; }
    if (!operationId || !field) { send(res, 400, { error: "send ?example=<name>&operation=<METHOD /path>&field=<name>, or just ?example=<name> to list every saved adapter" }); return true; }
    send(res, 200, { adapter: getAdapterFor(path.join(examplesDir, name), operationId, field) });
    return true;
  }

  if (req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch (err) { if (!res.headersSent) send(res, err.status ?? (err.code === 413 ? 413 : 400), { error: err.message }); return true; }
    const { example, operationId, field, transform, params, fromType, toType, value, questionId, run } = body ?? {};
    if (!known(example)) { send(res, 404, { error: "unknown example" }); return true; }
    if (typeof operationId !== "string" || !operationId || typeof field !== "string" || !field || typeof transform !== "string" || !transform) {
      send(res, 400, { error: 'send JSON like {"example": "x", "operationId": "GET /api/orders", "field": "status_code", "transform": "map", "params": {...}}' });
      return true;
    }
    // Never save a transform outside the closed set the source/target types actually allow (the picker only
    // ever offers these, but a request can't be trusted to have respected that client-side).
    const allowed = transformKindsFor(fromType ?? null, toType ?? null).map((t) => t.id);
    if (!allowed.includes(transform)) {
      send(res, 400, { error: `"${transform}" isn't an allowed mapping from ${fromType ?? "unknown"} to ${toType ?? "unknown"}` });
      return true;
    }
    // The same live-preview check the dialog runs before enabling Save (design §5): checked again server-side
    // so a stale/edited client can't save a mapping that fails against the endpoint's own example value.
    if (value !== undefined) {
      const preview = previewTransform(transform, params ?? {}, value);
      if (!preview.ok) { send(res, 400, { error: `this mapping isn't valid: ${preview.error}` }); return true; }
    }
    const adapters = saveAdapterFor(path.join(examplesDir, example), operationId, field, { transform, params });
    // LIN-190: resolve the open Tie in the same action, when the caller gave a run to resolve (the dialog does,
    // per docs/design/run-api-panel-and-wires.md §5: "it creates the mapping AND resolves the tie in one action").
    const resolved = !!(run && questionId && resolveRun?.(run, { operationId, field, transform, params }));
    send(res, 200, { ok: true, adapter: adapters[operationId][field], resolved });
    return true;
  }

  return false;
}
