#!/usr/bin/env node
// A small local web page for pasting TSX pages and seeing their groups (node:http, no dependencies).
//   node tools/feature-grouper/serve.mjs [--port N]        (default 4310; the next free port if taken)
// POST /api/group {source, threshold?, minSize?, embedder?} calls the same `groupPage` as the CLI.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupPage, PageParseError } from "./grouper.mjs";
import { demoPages, ROOT } from "./group.mjs";
import { buildPreview, RenderError } from "./render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 2 * 1024 * 1024;

// The two UMD builds the live-preview iframe loads as plain <script> globals (window.React/window.ReactDOM),
// vendored already as a demo-app dependency -- served locally so the sandboxed iframe needs no network access.
const VENDOR_FILES = {
  "react.js": path.join(ROOT, "demo-app", "node_modules", "react", "umd", "react.development.js"),
  "react-dom.js": path.join(ROOT, "demo-app", "node_modules", "react-dom", "umd", "react-dom.development.js"),
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Create (not start) the HTTP server.
 *
 * @returns {import("node:http").Server} The server: `GET /` page, `GET /api/demo[?i=N]`, `POST /api/group`.
 */
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(path.join(HERE, "page.html"), "utf8"), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname.startsWith("/vendor/")) {
        const file = VENDOR_FILES[url.pathname.slice("/vendor/".length)];
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: "no such vendor file" });
        return send(res, 200, fs.readFileSync(file, "utf8"), "application/javascript; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/api/demo") {
        const pages = demoPages();
        if (!url.searchParams.has("i")) return send(res, 200, { pages: pages.map((p) => path.relative(ROOT, p)) });
        const p = pages[Number(url.searchParams.get("i"))];
        if (!p) return send(res, 404, { error: "no such demo page" });
        return send(res, 200, { name: path.relative(ROOT, p), source: fs.readFileSync(p, "utf8") });
      }
      if (req.method === "POST" && url.pathname === "/api/group") {
        const body = JSON.parse(await readBody(req));
        if (typeof body.source !== "string" || !body.source.trim()) return send(res, 400, { error: "paste a page first" });
        const threshold = body.threshold === undefined || body.threshold === "" ? undefined : Number(body.threshold);
        const minSize = body.minSize === undefined ? undefined : Number(body.minSize);
        if ((threshold !== undefined && !Number.isFinite(threshold)) || (minSize !== undefined && !Number.isFinite(minSize))) return send(res, 400, { error: "threshold and minSize must be numbers" });
        const result = await groupPage(body.source, { file: body.file || "<pasted>", threshold, minSize, embedder: body.embedder || "hashed" });
        return send(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/render") {
        const body = JSON.parse(await readBody(req));
        if (typeof body.source !== "string" || !body.source.trim()) return send(res, 400, { error: "paste a page first" });
        const file = body.file || "<pasted>";
        // Relative imports only resolve against a real directory on disk; only trust `file` as one when it
        // is exactly one of the known demo-app pages (never an arbitrary client-supplied path).
        const match = demoPages().find((p) => path.relative(ROOT, p) === file);
        const resolveDir = match ? path.dirname(match) : undefined;
        const { code, entry, groups } = await buildPreview(body.source, { file, resolveDir });
        return send(res, 200, { code, entry, groups });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, e instanceof PageParseError || e instanceof RenderError ? 422 : 400, { error: e.message });
    }
  });
}

/**
 * Listen on `port`, or the next free port (up to 20 tries).
 *
 * @param {import("node:http").Server} server The server.
 * @param {number} port First port to try.
 * @returns {Promise<number>} The port it listens on (127.0.0.1 only).
 */
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = (p) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && tries++ < 20) attempt(p + 1);
        else reject(e);
      });
      server.listen(p, "127.0.0.1", () => resolve(p));
    };
    attempt(port);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  const want = i >= 0 ? Number(process.argv[i + 1]) : Number(process.env.PORT || 4310);
  const port = await listen(createServer(), want);
  console.log(`feature-grouper: http://127.0.0.1:${port}/`);
}
