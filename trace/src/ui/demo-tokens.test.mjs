// The shell's state colours hold 3:1 against every surface they sit on, in both themes, and the two dark blocks agree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "demo-tokens.css"), "utf8");
const block = (re) => { const m = re.exec(css); assert.ok(m, `block ${re}`); return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2].toLowerCase()])); };
const light = block(/^:root \{([^}]*)\}/m);
const darkMedia = block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);
const dark = block(/^:root\[data-theme="dark"\] \{([^}]*)\}/m);

const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const STATES = ["fit", "wait", "gap", "tie", "stub"], SURFACES = ["bg", "surface", "surface-2"];

test("Fit, Waiting, Gap, Tie and Stub each hold 3:1 on bg, surface and surface-2 in the light and the dark theme", () => {
  for (const [name, t] of [["light", light], ["dark", dark]]) for (const k of STATES) for (const s of SURFACES) {
    assert.ok(t[k], `${name} defines --${k}`);
    assert.ok(ratio(t[k], t[s]) >= 3, `${name}: --${k} ${t[k]} on --${s} ${t[s]} is ${ratio(t[k], t[s]).toFixed(2)}:1`);
  }
});

test("Waiting is not the colour of a Gap or of a Tie, and the system-dark block equals the toggled-dark block", () => {
  for (const t of [light, dark]) { assert.notEqual(t.wait, t.gap); assert.notEqual(t.wait, t.tie); }
  for (const k of [...STATES, ...SURFACES, "text", "muted", "accent"]) assert.equal(darkMedia[k], dark[k], `--${k} is the same in both dark blocks`);
});
