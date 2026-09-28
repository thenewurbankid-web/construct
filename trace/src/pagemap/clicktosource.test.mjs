import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traceResolveFiberSelection, resolveComponentCallSite, getResolver, traceInstallFiberBridge, traceBridgeScript, bridgeScript } from "./clicktosource.mjs";

const root = "/repo"; // a fixed project root: the fixtures below are plain payloads, not real paths on this machine

test("traceResolveFiberSelection: a data-cx-src annotation on the clicked element resolves exactly (tier 'annotation')", () => {
  const r = traceResolveFiberSelection({ selection: { componentName: "Button", annotation: "src/ui/Button.tsx:12:3", ancestors: [] } }, { projectRoot: root });
  assert.deepEqual(r, { ok: true, tier: "annotation", confidence: "exact", file: "src/ui/Button.tsx", line: 12, column: 3, componentName: "Button", ancestors: [], domPath: [], reason: null });
});

test("traceResolveFiberSelection: no annotation but fiber._debugSource resolves (tier 'debug-source'), and picks up the parent-page call site from the nearest component ancestor", () => {
  const payload = {
    componentName: "div",
    debugSource: { fileName: "/repo/src/components/PortfolioCard.tsx", lineNumber: 40, columnNumber: 5 }, // the clicked host element's OWN file: PortfolioCard's internals
    ancestors: [
      { componentName: "PortfolioCard", debugSource: { fileName: "/repo/src/pages/PortfolioHealth.tsx", lineNumber: 88, columnNumber: 9 } }, // where <PortfolioCard/> was WRITTEN: the call site
      { componentName: "Page", debugSource: { fileName: "/repo/src/pages/PortfolioHealth.tsx", lineNumber: 10, columnNumber: 3 } },
    ],
  };
  const self = traceResolveFiberSelection(payload, { projectRoot: root });
  assert.equal(self.ok, true);
  assert.equal(self.file, "src/components/PortfolioCard.tsx", "the element's own file, not yet the call site");
  const callSite = self.ancestors[0];
  assert.equal(callSite.componentName, "PortfolioCard");
  assert.equal(callSite.file, "src/pages/PortfolioHealth.tsx", "the CALL SITE is in the parent page's file, not PortfolioCard's own");
  assert.equal(callSite.line, 88);
  assert.equal(self.ancestors.length, 2);
});

test("resolveComponentCallSite: the convenience wrapper returns the same nearest-ancestor call site (falls back to Trace without CONSTRUCT_ROOT)", async () => {
  const payload = {
    componentName: "span",
    debugSource: { fileName: "/repo/src/components/Widget.tsx", lineNumber: 5, columnNumber: 1 },
    ancestors: [{ componentName: "Widget", debugSource: { fileName: "/repo/src/pages/Home.tsx", lineNumber: 20, columnNumber: 2 } }],
  };
  const r = await resolveComponentCallSite(payload, { projectRoot: root }, undefined);
  assert.equal(r.source, "trace");
  assert.equal(r.callSite.file, "src/pages/Home.tsx");
  assert.equal(r.callSite.line, 20);
});

test("resolveComponentCallSite: no evidence at all is an honest miss (component name only, or nothing), never a guess", async () => {
  const r1 = await resolveComponentCallSite({ componentName: "Widget", ancestors: [] }, { projectRoot: root }, undefined);
  assert.equal(r1.self.ok, false);
  assert.equal(r1.self.reason, "no-evidence");
  assert.equal(r1.self.tier, "component");
  assert.equal(r1.callSite, null);
  const r2 = await resolveComponentCallSite({}, { projectRoot: root }, undefined);
  assert.equal(r2.self.tier, null);
  assert.equal(r2.callSite, null);
});

test("traceResolveFiberSelection: a file outside the project root is never named (containment, not a path guess)", () => {
  const r = traceResolveFiberSelection({ debugSource: { fileName: "/etc/passwd", lineNumber: 1, columnNumber: 1 } }, { projectRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.file, null);
});

test("traceResolveFiberSelection: projectRoot is required", () => {
  assert.throws(() => traceResolveFiberSelection({}, {}), /projectRoot/);
});

test("getResolver: falls back to Trace's resolver without a CONSTRUCT_ROOT, or with a bad one", async () => {
  assert.equal((await getResolver(undefined)).source, "trace");
  assert.equal((await getResolver("/no/such/checkout")).source, "trace");
});

test("traceInstallFiberBridge: only installs inside a parent frame, and only once", () => {
  const win = { parent: null, document: { addEventListener() {} } };
  win.parent = { postMessage() {} }; // embedded (parent !== self)
  assert.equal(traceInstallFiberBridge(win), true);
  assert.equal(traceInstallFiberBridge(win), false, "already installed");
  const top = {}; top.parent = top; // not embedded: parent === self
  assert.equal(traceInstallFiberBridge(top), false);
});

test("traceBridgeScript: serialises to a self-invoking script that installs the same function (no closure over module scope)", () => {
  const script = traceBridgeScript();
  assert.match(script, /^\(function traceInstallFiberBridge/);
  assert.match(script, /\)\(window\);$/);
});

test("bridgeScript: Trace's script without a checkout, needs no options", async () => {
  const r = await bridgeScript(undefined, undefined);
  assert.equal(r.source, "trace");
  assert.equal(r.script, traceBridgeScript());
});

// ---------- against the real Construct checkout, when present ----------
const CONSTRUCT_CHECKOUT = "/Users/shashank/Repositories/construct-worktrees/cockpit-main";
const hasConstruct = fs.existsSync(path.join(CONSTRUCT_CHECKOUT, "packages", "engine", "previewFiber.mjs"));

test("against Construct's own resolveFiberSelection: same call-site answer for the same evidence, when a checkout is present", { skip: hasConstruct ? false : `no Construct checkout at ${CONSTRUCT_CHECKOUT}` }, async () => {
  const payload = {
    protocol: "construct-preview/1",
    componentName: "div",
    debugSource: { fileName: "/repo/src/components/PortfolioCard.tsx", lineNumber: 40, columnNumber: 5 },
    ancestors: [{ componentName: "PortfolioCard", debugSource: { fileName: "/repo/src/pages/PortfolioHealth.tsx", lineNumber: 88, columnNumber: 9 } }],
    domPath: [],
  };
  const r = await resolveComponentCallSite(payload, { projectRoot: root }, CONSTRUCT_CHECKOUT);
  assert.equal(r.source, "construct");
  assert.equal(r.callSite.file, "src/pages/PortfolioHealth.tsx");
  assert.equal(r.callSite.line, 88);
  const trace = traceResolveFiberSelection(payload, { projectRoot: root });
  assert.equal(trace.file, r.self.file, "Trace's fallback agrees with Construct's real resolver on the same debug-source evidence");

  const real = await bridgeScript({ nonce: "n", parentOrigin: "https://example.test" }, CONSTRUCT_CHECKOUT);
  assert.equal(real.source, "construct");
  assert.match(real.script, /construct-preview\/1/);
});
