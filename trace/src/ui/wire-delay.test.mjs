// The pause after "Wire it" that lets the hero's pulse be seen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WIRE_DELAY_MS, wireDelay } from "./wire-delay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the delay is one named constant, about 350 ms", () => {
  assert.equal(WIRE_DELAY_MS, 350);
  assert.equal(wireDelay(), WIRE_DELAY_MS);
  assert.equal(wireDelay({}), WIRE_DELAY_MS);
});

test("there is no delay with reduced motion, or from the keyboard shortcut (which plays no pulse)", () => {
  assert.equal(wireDelay({ reduced: true }), 0);
  assert.equal(wireDelay({ shortcut: true }), 0);
  assert.equal(wireDelay({ reduced: true, shortcut: true }), 0);
  assert.equal(wireDelay({ reduced: false, shortcut: false }), WIRE_DELAY_MS);
});

test("the shell uses the helper, not a number of its own, and the shortcut path skips the wait", () => {
  const src = fs.readFileSync(path.join(here, "demo.mjs"), "utf8");
  assert.match(src, /wireDelay\(\{ reduced: reduced\(\), shortcut \}\)/);
  assert.match(src, /wire\(\{ shortcut: true \}\)/, "Space with no button focused starts the run at once");
  assert.match(src, /if \(t\.id === "bWire"\) return wire\(\);/, "the button waits for the pulse");
  assert.doesNotMatch(src, /sleep\(350\)/);
});
