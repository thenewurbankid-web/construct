// The design thumbnail: what goes into the sandboxed frame, and the scale.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THUMB, thumbScale, thumbDoc, colorCss, COLOR_VARS } from "./thumb.mjs";
import { bannedIn } from "./vocab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the page is laid out at a fixed width and scaled to the box (320 wide gives 0.32)", () => {
  assert.equal(THUMB.pageW, 1000);
  assert.equal(thumbScale(320), 0.32);
  assert.equal(Math.round(THUMB.pageW * THUMB.ratio), 625, "a 320 x 200 box shows all of it");
  assert.equal(thumbScale(0), 0);
  assert.equal(thumbScale(-5), 0);
});

test("the colours come from the shell's own values, with nothing that could close the style block", () => {
  const css = colorCss((n) => (n === "--gap" ? "#ff8b7c;}</style><script>x" : "#123456"), true);
  assert.match(css, /^:root\{color-scheme:dark;/);
  assert.equal(COLOR_VARS.length, css.split(";").length - 1, "one line per variable");
  assert.doesNotMatch(css, /[<>]/);
  assert.equal((css.match(/[{}]/g) ?? []).length, 2, "one rule, opened and closed by us");
  assert.match(colorCss(() => "#000", false), /color-scheme:light/);
  assert.ok(COLOR_VARS.includes("--wait"), "the frame knows the Waiting colour");
});

test("the frame's document holds the page inside .pv, is inert, and cannot be closed early by a style", () => {
  const doc = thumbDoc('<main class="page"><h1>Orders</h1></main>', "a{}</style><script>alert(1)</script>", ":root{--bg:#fff}");
  assert.match(doc, /<div class="pv"><main class="page"><h1>Orders<\/h1><\/main><\/div>/);
  assert.match(doc, /pointer-events:none!important/);
  assert.equal((doc.match(/<\/style>/g) ?? []).length, 1, "only our own closing tag");
  assert.ok(doc.indexOf("<script>alert") < doc.indexOf("</style>"), "whatever the styles held stays inside the style block, as text");
  assert.match(doc, /:root\{--bg:#fff\}/);
  assert.match(thumbDoc(null, "", ""), /<div class="pv"><\/div>/);
});

test("the shell builds the frame sandboxed, hidden from assistive tech, and keeps a text caption", () => {
  const src = fs.readFileSync(path.join(here, "demo.mjs"), "utf8"), html = fs.readFileSync(path.join(here, "demo.html"), "utf8");
  assert.match(src, /setAttribute\("sandbox", ""\)/, "no scripts and no same-origin access");
  assert.match(src, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(src, /setAttribute\("tabindex", "-1"\)/);
  assert.match(html, /id="thumbFrame" aria-hidden="true"/);
  assert.match(html, /<figcaption id="thumbCap">/);
  assert.deepEqual(bannedIn(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")), []);
});
