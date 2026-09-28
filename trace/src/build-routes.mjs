// Routes that report which build is running: /api/health, /api/build, /api/about, the About page and its modules.
// Kept out of server.mjs so the server only gains one import and one line; everything here takes plain arguments and is
// tested with a fake response.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBuildInfo } from "./build-info.mjs";
import { parseChangelog } from "./changelog.mjs";
import { listReleases, readState } from "./deploy/releases.mjs";

// The running build: build-info.json next to the server (written by the deploy), or, in a dev checkout without one,
// computed once at start and marked dev.
/**
 * Load the running build's identity.
 *
 * @param {string} root The server's root directory.
 * @returns {object} The parsed `build-info.json` next to the server (written by the deploy), or, in a dev
 *   checkout without one, a build computed once at start-up with `dev: true`.
 */
export function loadRunningBuild(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "build-info.json"), "utf8"));
  } catch {
    return { ...computeBuildInfo(root, { builtAt: null }), dev: true };
  }
}

/**
 * Build the context these routes are handed on every request.
 *
 * @param {{root: string, getPort?: () => number|null, now?: () => number, build?: object}} options
 *   `getPort`/`now` default to real values; `build` defaults to {@link loadRunningBuild}.
 * @returns {{root: string, getPort: Function, now: Function, build: object, startedAt: number}}
 */
export function createBuildContext({ root, getPort = () => null, now = Date.now, build = loadRunningBuild(root) }) {
  return { root, getPort, now, build, startedAt: now() };
}

// build-info.json minus the (long) file lists
/**
 * `build-info.json` without the (potentially long) `changesSincePrevious` file lists.
 *
 * @param {object} build A build (as from {@link loadRunningBuild}).
 * @returns {object} The build, minus `changesSincePrevious`.
 */
export function slimBuild(build) {
  const { changesSincePrevious, ...rest } = build; // eslint-disable-line no-unused-vars
  return rest;
}

const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/**
 * The About page's data: the (slimmed) build, the parsed changelog, what changed since the previous deploy,
 * deploy history (when actually deployed), the Node version, port and uptime.
 *
 * @param {{root: string, build: object, getPort: () => number|null, now: () => number, startedAt: number}} ctx
 *   From {@link createBuildContext}.
 * @returns {object} The About page payload.
 */
export function aboutPayload(ctx) {
  const { root, build } = ctx;
  const deployDir = path.dirname(root);
  const deployed = !build.dev && path.basename(deployDir) === "deploy";
  const current = deployed ? readState(deployDir).current ?? build.version : null;
  return {
    build: slimBuild(build),
    changelog: parseChangelog(readText(path.join(root, "CHANGELOG.md"))),
    changesSincePrevious: build.changesSincePrevious ?? null,
    history: deployed ? listReleases(deployDir, { current }) : [],
    node: process.version,
    port: ctx.getPort(),
    previousVersion: build.previousVersion ?? null,
    tests: build.tests ?? null,
    uptimeSec: Math.max(0, Math.round((ctx.now() - ctx.startedAt) / 1000)),
  };
}

const UI = { "/about": ["ui/about.html", "text/html; charset=utf-8"], "/ui/about.mjs": ["ui/about.mjs", "text/javascript"], "/ui/build-badge.mjs": ["ui/build-badge.mjs", "text/javascript"] };
const DOCS = { "/doc/README.md": "README.md", "/doc/CHANGELOG.md": "CHANGELOG.md", "/doc/DEPLOY-LOCAL.md": "docs/DEPLOY-LOCAL.md", "/doc/SECURITY.md": "docs/SECURITY.md" };
const here = path.dirname(fileURLToPath(import.meta.url));

// Returns true when it answered the request.
/**
 * Handle the build-identity routes: `/api/health`, `/api/build`, `/api/about`, the About page and its modules,
 * and a few plain-text doc files.
 *
 * @param {string} p The request's pathname.
 * @param {import("node:http").ServerResponse} res
 * @param {{root: string, build: object, getPort: () => number|null, now: () => number, startedAt: number}} ctx
 *   From {@link createBuildContext}.
 * @returns {boolean} `true` when this handled the request.
 */
export function handleBuildRoute(p, res, ctx) {
  const json = (body) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
  const send = (type, text) => { res.writeHead(text == null ? 404 : 200, { "content-type": type, "cache-control": "no-store" }); res.end(text ?? "not found"); return true; };
  if (p === "/api/health") return json({ app: "trace", hash: ctx.build.hash, ok: true, pid: process.pid, version: ctx.build.version });
  if (p === "/api/build") return json(slimBuild(ctx.build));
  if (p === "/api/about") return json(aboutPayload(ctx));
  if (UI[p]) return send(UI[p][1], readText(path.join(here, UI[p][0])) || null);
  if (DOCS[p]) return send("text/plain; charset=utf-8", readText(path.join(ctx.root, DOCS[p])) || null);
  return false;
}
