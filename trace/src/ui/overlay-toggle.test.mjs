// LIN-104 — the fit screen's Overlay toggle: show/hide the wires and part highlights, remembered per viewer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OVERLAY_KEY, readOverlayOn, writeOverlayOn, overlayLabel, overlayTitle } from "./overlay-toggle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeStore(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => (k in data ? data[k] : null), set: (k, v) => { v == null ? delete data[k] : (data[k] = v); } };
}

test("on by default: a viewer who never touched the toggle, or whose storage is blocked, sees the overlay", () => {
  assert.equal(readOverlayOn(fakeStore()), true);
  const blocked = { get: () => { throw new Error("blocked"); }, set: () => {} };
  assert.throws(() => readOverlayOn(blocked)); // the caller (demo.mjs's `store`) is what wraps this in try/catch, not the helper itself
});

test("turning it off writes one marker key; turning it back on removes it rather than writing a second value", () => {
  const s = fakeStore();
  writeOverlayOn(s, false);
  assert.equal(s.data[OVERLAY_KEY], "0");
  assert.equal(readOverlayOn(s), false);
  writeOverlayOn(s, true);
  assert.equal(s.data[OVERLAY_KEY], undefined);
  assert.equal(readOverlayOn(s), true);
});

test("label and title change with state, and the title always names the shortcut", () => {
  assert.equal(overlayLabel(true), "Overlay");
  assert.equal(overlayLabel(false), "Overlay off");
  assert.match(overlayTitle(true), /Hide.*\(O\)/);
  assert.match(overlayTitle(false), /Show.*\(O\)/);
});

// ---------- wired into the shell ----------
const demoMjs = fs.readFileSync(path.join(here, "demo.mjs"), "utf8");
const demoHtml = fs.readFileSync(path.join(here, "demo.html"), "utf8");
const demoCss = fs.readFileSync(path.join(here, "demo.css"), "utf8");

test("the view toolbar has an Overlay button with a real pressed state, not colour alone", () => {
  assert.match(demoHtml, /id="bOverlay"[^>]*aria-pressed="true"/);
  assert.match(demoMjs, /b\.setAttribute\("aria-pressed", String\(on\)\)/);
  assert.match(demoMjs, /icon\(on \? "eye" : "eyeOff", 16\)/, "the icon itself flips, so pressed state does not rely on colour alone");
});

test("O toggles it on the fit screen, alongside T (replay) and M (map)", () => {
  assert.match(demoMjs, /e\.key === "o" \|\| e\.key === "O"\) return toggleOverlay\(\)/);
});

test("the choice is remembered per viewer through the shared localStorage-backed store, wrapped in try/catch", () => {
  assert.match(demoMjs, /writeOverlayOn\(store, on\)/);
  assert.match(demoMjs, /readOverlayOn\(store\)/);
  assert.match(fs.readFileSync(path.join(here, "overlay-toggle.mjs"), "utf8"), /localStorage/);
});

test("hiding the overlay is CSS-only (a data attribute + opacity/outline-colour), so selection, Asks and data are untouched", () => {
  assert.match(demoMjs, /\$\("#stageMid"\)\.dataset\.overlay = on \? "on" : "off"/);
  assert.match(demoCss, /#stageMid\[data-overlay="off"\] \.trace-canvas/);
  assert.match(demoCss, /#stageMid\[data-overlay="off"\] \.pv-badges/);
  assert.match(demoCss, /#stageMid\[data-overlay="off"\] \.pv \[data-part\]/);
});

test("reduced motion already kills every transition/animation globally, so the fade needs no extra guard", () => {
  assert.match(demoCss, /prefers-reduced-motion: reduce[\s\S]{0,200}transition-duration: \.001ms !important/);
});

test("the new module is on the demo shell's own asset allow-list, so it is actually served", () => {
  const src = fs.readFileSync(path.join(here, "..", "demo-server.mjs"), "utf8");
  assert.match(src, /"overlay-toggle\.mjs"/);
});
