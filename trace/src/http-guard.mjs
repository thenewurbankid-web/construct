// The one place that decides whether an HTTP request may reach a route. EVERY route must go through it: server.mjs
// calls `checkRequest` once, before routing, and `readJsonBody` for every body. A new route (for example /api/openapi,
// /api/suggest, /api/part-chat, /api/demo/*) needs no extra code to be protected, but must never read `req` on its
// own or be dispatched before the guard.
//
// Why: the server runs on the user's machine and can spend model tokens and write files. A web page on another site
// can make the browser send requests to http://localhost:<port> (a "simple" cross-site POST needs no preflight), and
// DNS rebinding can make a hostile name resolve to 127.0.0.1. So:
//   1. Host must be localhost / 127.0.0.1 / [::1] with this server's port        (all requests: DNS-rebinding defence)
//   2. a present Origin must be exactly http://<that host>                         (state-changing requests: CSRF)
//   3. a state-changing request must be `content-type: application/json`         (a plain <form> cannot send it, and
//                                                                                   anything else needs a preflight)
// Read-only GETs (pages, SSE streams) need only 1. State-changing = every method except GET/HEAD.
// Bodies: bad JSON is a 400, an oversized body a 413, an aborted upload a 400 — none of them can throw out of a handler.

export const MAX_BODY = 2 * 1024 * 1024;
export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const READ_ONLY = new Set(["GET", "HEAD"]);
/**
 * Whether an HTTP method can change state (everything except GET/HEAD).
 *
 * @param {string} method An HTTP method.
 * @returns {boolean}
 */
export const isStateChanging = (method) => !READ_ONLY.has(String(method).toUpperCase());

// hostHeader: the raw `Host` header, e.g. "localhost:4200". Returns the normalised host or null.
/**
 * Validate the request's `Host` header against this server's own local host and port (DNS-rebinding defence).
 *
 * @param {string|undefined} hostHeader The raw `Host` header, e.g. `"localhost:4200"`.
 * @param {number|string} port The port this server listens on.
 * @returns {string|null} The lower-cased host when it is `localhost`/`127.0.0.1`/`[::1]` on this exact port,
 *   else `null`.
 */
export function allowedHost(hostHeader, port) {
  const m = typeof hostHeader === "string" ? hostHeader.toLowerCase().match(/^(localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})$/) : null;
  return m && Number(m[2]) === Number(port) ? hostHeader.toLowerCase() : null;
}

// Returns null when the request may proceed, else { status, error }. `port` is the port the server listens on.
/**
 * The one gate every route must pass through, before routing: Host check (all requests), then, for
 * state-changing requests, Origin check (CSRF) and `content-type: application/json` (blocks plain `<form>`
 * posts and anything needing a CORS preflight).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number|string} port The port this server listens on.
 * @returns {{status: number, error: string}|null} `null` when the request may proceed, else the status and
 *   message to send.
 */
export function checkRequest(req, port) {
  const host = allowedHost(req.headers.host, port);
  if (!host) return { status: 403, error: "forbidden: unexpected Host header (use http://localhost:" + port + ")" };
  if (!isStateChanging(req.method)) return null;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return { status: 403, error: "forbidden: cross-origin request" };
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { status: 415, error: "unsupported media type: send application/json" };
  return null;
}

// The parsed JSON object of the request body ({} when empty). Rejects with HttpError; never throws anything else.
/**
 * Read and parse a request body as a bounded JSON object.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {{limit?: number}} [options] `limit` in bytes (default {@link MAX_BODY}).
 * @returns {Promise<object>} The parsed JSON object (`{}` when the body is empty).
 * @throws {HttpError} 413 over the limit, 400 for invalid JSON, a non-object body, or an aborted/closed request.
 *   Never rejects with anything else.
 */
export function readJsonBody(req, { limit = MAX_BODY } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    const fail = (status, message) => { if (done) return; done = true; cleanup(); reject(new HttpError(status, message)); };
    const onData = (c) => {
      size += c.length;
      if (size > limit) { fail(413, `request body too large (limit ${limit} bytes)`); req.resume(); return; }
      chunks.push(c);
    };
    const onEnd = () => {
      if (done) return;
      done = true; cleanup();
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      let value;
      try { value = JSON.parse(text); } catch { return reject(new HttpError(400, "the request body is not valid JSON")); }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return reject(new HttpError(400, "the request body must be a JSON object"));
      resolve(value);
    };
    const onAbort = () => fail(400, "request aborted");
    const cleanup = () => { req.off("data", onData); req.off("end", onEnd); req.off("error", onAbort); req.off("aborted", onAbort); req.off("close", onClose); };
    const onClose = () => { if (!req.complete) onAbort(); };
    req.on("data", onData); req.on("end", onEnd); req.on("error", onAbort); req.on("aborted", onAbort); req.on("close", onClose);
  });
}

// Answers with a JSON error unless the headers are already out (then the stream is just ended).
/**
 * Send a JSON `{error}` response, or just end the stream if headers were already sent.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {number} status HTTP status code.
 * @param {string} message Error message.
 * @returns {void}
 */
export function sendError(res, status, message) {
  if (res.writableEnded) return;
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { "content-type": "application/json", connection: status === 413 ? "close" : "keep-alive" });
  res.end(JSON.stringify({ error: message }));
}
