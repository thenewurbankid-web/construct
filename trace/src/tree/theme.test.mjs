// WCAG contrast checks for both themes, computed from the shipped THEME_CSS (the same string /theme.css serves),
// so a palette edit that breaks legibility fails `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { THEME_CSS, TOKENS } from "./svg.mjs";

// ---- WCAG 2.x relative luminance and contrast ratio ----
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// what CSS color-mix(in srgb, fg p%, bg) produces
const mix = (fg, bg, p) => "#" + rgb(fg).map((c, i) => Math.round(c * p + rgb(bg)[i] * (1 - p)).toString(16).padStart(2, "0")).join("");

// ---- read the tokens back out of the CSS text, per theme ----
function parseDecls(body) {
  const out = {};
  for (const d of body.split(";")) { const m = d.match(/^--([\w-]+):(.+)$/); if (m) out[m[1]] = m[2].trim(); }
  return out;
}
const light = parseDecls(THEME_CSS.match(/^:root\{([^}]*)\}/m)[1]);
const dark = parseDecls(THEME_CSS.match(/:root\[data-theme="dark"\]\{([^}]*)\}/)[1]);
const darkAuto = parseDecls(THEME_CSS.match(/prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/)[1]);
const THEMES = { light, dark };

const TEXT = 4.5, LARGE_OR_UI = 3;
const SEMANTIC = ["grn", "amb", "red", "ph", "acc"];
const LAYERS = ["ly-Page", "ly-Component", "ly-Controller", "ly-Domain", "ly-Service", "ly-Workflow", "ly-Route"];
const TEAMS = ["acc", "ph", "ly-Workflow", "ly-Component"]; // backend, product, design, frontend (see .team-* in index.html)

test("theme CSS carries both palettes and the data-theme overrides", () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(), "light and dark define the same tokens");
  assert.deepEqual(dark, darkAuto, "the system-dark rule and data-theme=dark are the same palette");
  assert.deepEqual(light, Object.fromEntries(Object.entries(TOKENS.light).map(([k, v]) => [k, v])));
  assert.match(THEME_CSS, /:root\{color-scheme:light;/);
  assert.match(THEME_CSS, /:root\[data-theme="dark"\]\{color-scheme:dark;/);
  assert.notEqual(light.bg.toLowerCase(), "#ffffff", "the light page is not stark white");
  assert.notEqual(light.card.toLowerCase(), "#ffffff", "light surfaces are not stark white");
});

for (const [name, T] of Object.entries(THEMES)) {
  const check = (label, fg, bg, min) => {
    const r = contrast(fg, bg);
    assert.ok(r >= min, `${name}: ${label} is ${r.toFixed(2)}:1 (${fg} on ${bg}), needs ${min}:1`);
  };

  test(`${name}: body and muted text on every surface`, () => {
    for (const s of ["bg", "card", "stat"]) { check(`fg on ${s}`, T.fg, T[s], TEXT); check(`mut on ${s}`, T.mut, T[s], TEXT); }
    check("fg on selection", T.fg, T.sel, TEXT);
  });

  test(`${name}: semantic colours as text on the page and the raised surface`, () => {
    for (const c of SEMANTIC) for (const s of ["bg", "card"]) check(`${c} on ${s}`, T[c], T[s], TEXT);
  });

  test(`${name}: semantic colours on their own tinted fills`, () => {
    check("red on redbg", T.red, T.redbg, TEXT);
    check("amb on ambbg", T.amb, T.ambbg, TEXT);
    check("ph on phbg", T.ph, T.phbg, TEXT);
    for (const c of ["grn", "amb", "red", "acc"]) for (const p of [0.16, 0.18]) check(`${c} on ${c} ${p * 100}% over card`, T[c], mix(T[c], T.card, p), TEXT);
    check("fg on grn 16% over card (diff add)", T.fg, mix(T.grn, T.card, 0.16), TEXT);
    check("fg on red 16% over card (diff del)", T.fg, mix(T.red, T.card, 0.16), TEXT);
    check("mut on stat", T.mut, T.stat, TEXT);
  });

  test(`${name}: layer colours as text on the surfaces`, () => {
    for (const c of LAYERS) for (const s of ["bg", "card"]) check(`${c} on ${s}`, T[c], T[s], TEXT);
  });

  test(`${name}: text on a filled accent or team-coloured button`, () => {
    for (const c of TEAMS) check(`on-acc on ${c}`, T["on-acc"], T[c], TEXT);
  });

  test(`${name}: control borders and tree links are visible (3:1)`, () => {
    for (const t of ["bd2", "line"]) for (const s of ["bg", "card"]) check(`${t} against ${s}`, T[t], T[s], LARGE_OR_UI);
  });
}

test("contrast helper matches known WCAG values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
});
