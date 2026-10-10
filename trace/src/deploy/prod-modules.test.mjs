import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { devOnlyModulePaths, productionFilter, copyProductionModules } from "./prod-modules.mjs";

const LOCK = { packages: {
  "": { name: "x" },
  "node_modules/yaml": { version: "1" },
  "node_modules/three": { version: "1", dev: true },
  "node_modules/esbuild": { version: "1", dev: true },
  "node_modules/@esbuild/darwin-arm64": { version: "1", dev: true, optional: true },
  "node_modules/opt": { version: "1", devOptional: true },
  "node_modules/yaml/node_modules/devonly": { version: "1", dev: true },
} };

test("only packages marked dev in the lockfile are dev-only (devOptional stays)", () => {
  assert.deepEqual([...devOnlyModulePaths(LOCK)].sort(), ["node_modules/@esbuild/darwin-arm64", "node_modules/esbuild", "node_modules/three", "node_modules/yaml/node_modules/devonly"]);
  assert.equal(devOnlyModulePaths(null).size, 0);
  assert.equal(devOnlyModulePaths({}).size, 0);
});

test("the filter drops dev packages at any depth, .bin links into them, and the hidden lockfile", () => {
  const root = "/n/node_modules", dev = devOnlyModulePaths(LOCK);
  const links = { "/n/node_modules/.bin/esbuild": "../esbuild/bin/esbuild", "/n/node_modules/.bin/yaml": "../yaml/bin.mjs", "/n/node_modules/.bin/scoped": "../@esbuild/darwin-arm64/bin/x" };
  const f = productionFilter(root, dev, (p) => { if (p in links) return links[p]; throw new Error("not a link"); });
  assert.equal(f(root), true);
  for (const p of ["yaml", "yaml/index.js", "opt", ".bin", ".bin/yaml", "@babel/parser"]) assert.equal(f(`${root}/${p}`), true, p);
  for (const p of ["three", "three/build/three.js", "esbuild", "@esbuild/darwin-arm64", "@esbuild/darwin-arm64/bin/esbuild", "yaml/node_modules/devonly", ".bin/esbuild", ".bin/scoped", ".package-lock.json"]) assert.equal(f(`${root}/${p}`), false, p);
});

test("copyProductionModules copies the production set only, reports what it left out, and copies everything without a lockfile", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "trace-prod-"));
  const put = (rel, text = "x") => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
  put("src/node_modules/yaml/index.js"); put("src/node_modules/three/build/three.js"); put("src/node_modules/esbuild/bin/esbuild");
  fs.mkdirSync(path.join(d, "src/node_modules/.bin"), { recursive: true });
  fs.symlinkSync("../esbuild/bin/esbuild", path.join(d, "src/node_modules/.bin/esbuild"));
  fs.symlinkSync("../yaml/index.js", path.join(d, "src/node_modules/.bin/yaml"));
  put("src/package-lock.json", JSON.stringify(LOCK));
  const r = copyProductionModules(path.join(d, "src/node_modules"), path.join(d, "out/node_modules"), path.join(d, "src/package-lock.json"));
  assert.deepEqual(r, { skipped: ["node_modules/esbuild", "node_modules/three"], all: false });
  put("src/node_modules/@esbuild/darwin-arm64/bin/x"); put("src/node_modules/@keep/pkg/index.js");
  const lock2 = { packages: { ...LOCK.packages, "node_modules/@keep/pkg": { version: "1" } } };
  fs.writeFileSync(path.join(d, "src/package-lock.json"), JSON.stringify(lock2));
  fs.rmSync(path.join(d, "out"), { recursive: true, force: true });
  copyProductionModules(path.join(d, "src/node_modules"), path.join(d, "out/node_modules"), path.join(d, "src/package-lock.json"));
  assert.deepEqual(fs.readdirSync(path.join(d, "out/node_modules")).sort(), [".bin", "@keep", "yaml"], "no empty @esbuild folder is left behind");
  assert.deepEqual(fs.readdirSync(path.join(d, "out/node_modules/.bin")), ["yaml"]);
  assert.equal(fs.lstatSync(path.join(d, "out/node_modules/.bin/yaml")).isSymbolicLink(), true);
  const all = copyProductionModules(path.join(d, "src/node_modules"), path.join(d, "out2/node_modules"), path.join(d, "missing.json"));
  assert.equal(all.all, true);
  assert.ok(fs.existsSync(path.join(d, "out2/node_modules/three/build/three.js")), "no lockfile: nothing is dropped");
});
