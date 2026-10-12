// #867: Trace on Termux (Android) — browser open, source-only watching, toybox-safe pid ownership.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { browserOpener, openBrowser, processCommandLine, sourceWatchDirs, watchSources } from "./platform.mjs";

const has = (...cmds) => (c) => cmds.includes(c);

test("browserOpener: open on darwin, xdg-open on linux, termux-open-url on android", () => {
  assert.equal(browserOpener("darwin", has("open")), "open");
  assert.equal(browserOpener("linux", has("xdg-open")), "xdg-open");
  assert.equal(browserOpener("android", has("termux-open-url")), "termux-open-url");
});

test("browserOpener: null when the command is missing or the platform is unknown", () => {
  assert.equal(browserOpener("linux", has()), null);
  assert.equal(browserOpener("android", has("xdg-open")), null);
  assert.equal(browserOpener("win32", has("open", "xdg-open")), null);
});

test("openBrowser: execs the platform opener, silently skips when absent", () => {
  const calls = [];
  const execFile = (cmd, argv, cb) => { calls.push([cmd, argv]); cb?.(null); };
  assert.equal(openBrowser("http://localhost:1", { platform: "android", hasCommand: has("termux-open-url"), execFile }), true);
  assert.deepEqual(calls, [["termux-open-url", ["http://localhost:1"]]]);
  assert.equal(openBrowser("http://localhost:1", { platform: "linux", hasCommand: has(), execFile }), false);
  assert.equal(calls.length, 1);
});

test("processCommandLine: reads /proc/<pid>/cmdline (NUL-separated) when it exists", () => {
  let psCalled = false;
  const fsx = { readFileSync: (f) => { assert.equal(f, "/proc/42/cmdline"); return Buffer.from("node\0/x/deploy/server.mjs\0--port\x004200\0"); } };
  const cmd = processCommandLine(42, { fs: fsx, execFileSync: () => { psCalled = true; return ""; } });
  assert.equal(cmd, "node /x/deploy/server.mjs --port 4200");
  assert.equal(psCalled, false);
});

test("processCommandLine: falls back to ps when there is no /proc (macOS)", () => {
  const fsx = { readFileSync: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } };
  const execFileSync = (cmd, argv) => { assert.equal(cmd, "ps"); assert.deepEqual(argv, ["-p", "7", "-o", "command="]); return "node /x/deploy/server.mjs\n"; };
  assert.equal(processCommandLine(7, { fs: fsx, execFileSync }), "node /x/deploy/server.mjs");
});

test("processCommandLine: empty string when neither works", () => {
  const fsx = { readFileSync: () => { throw new Error("no"); } };
  assert.equal(processCommandLine(7, { fs: fsx, execFileSync: () => { throw new Error("toybox"); } }), "");
});

// a tiny in-memory tree for readdirSync(dir, { withFileTypes: true })
function fakeFs(tree) {
  const node = (dir) => dir.split(path.sep).filter(Boolean).reduce((n, p) => n?.[p], tree);
  return {
    readdirSync: (dir) => Object.entries(node(dir) ?? {}).map(([name, v]) => ({ name, isDirectory: () => typeof v === "object" })),
    watched: [],
    watch(dir, opts, cb) { this.watched.push({ dir, opts, cb }); return { close() {} }; },
  };
}

test("sourceWatchDirs: source dirs only, never node_modules/.git/dist, at any depth", () => {
  const fsx = fakeFs({ r: {
    "package.json": 1, node_modules: { a: { b: {} } }, ".git": { objects: {} }, dist: { x: {} }, deploy: { v1: {} },
    src: { "server.mjs": 1, deploy: { "d.mjs": 1 }, dist: {} },
    "subframe-app": { node_modules: { big: {} }, src: { ui: {} } },
    docs: { theme: {} }, examples: { one: {} },
  } });
  const dirs = sourceWatchDirs("/r", { fs: fsx }).map((d) => path.relative("/r", d) || ".");
  assert.deepEqual(dirs.sort(), [".", "docs", "docs/theme", "examples", "examples/one", "src", "src/deploy", "subframe-app", "subframe-app/src", "subframe-app/src/ui"].sort());
  assert.ok(!dirs.some((d) => /node_modules|\.git|dist/.test(d)));
});

test("watchSources: non-recursive watches, change paths reported relative to root", () => {
  const fsx = fakeFs({ r: { src: { "a.mjs": 1 }, node_modules: { x: {} } } });
  const seen = [];
  watchSources("/r", (rel) => seen.push(rel), { fs: fsx });
  assert.ok(fsx.watched.every((w) => !w.opts?.recursive));
  assert.ok(!fsx.watched.some((w) => w.dir.includes("node_modules")));
  fsx.watched.find((w) => w.dir === path.join("/r", "src")).cb("change", "a.mjs");
  fsx.watched.find((w) => w.dir === "/r").cb("change", "package.json");
  fsx.watched[0].cb("change", null);
  assert.deepEqual(seen, [path.join("src", "a.mjs"), "package.json"]);
});
