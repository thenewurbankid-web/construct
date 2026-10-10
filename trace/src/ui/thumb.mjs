// The design thumbnail on the Drop in screen: a small, live, inert picture of the selected screen's designed page. The page comes
// from the existing preview (GET /api/preview) and is drawn in a sandboxed frame (no scripts, no same-origin access) at a fixed
// desktop width, then scaled down to the box. Pure functions only: the shell builds the frame, this file builds what goes in it.
export const THUMB = { pageW: 1000, ratio: 0.625 }; // the page is laid out 1000 px wide and 625 px tall, then scaled to the box (320 x 200 at full size)

// Scale that fits the laid-out page into a box of this CSS width.
export const thumbScale = (boxW) => (boxW > 0 ? boxW / THUMB.pageW : 0);

// The colours the page's styles read, copied from the shell as it is right now (so the picture follows the theme, including a
// manual switch that differs from the system setting). read(name) returns the computed value of a custom property.
export const COLOR_VARS = ["--bg", "--surface", "--surface-2", "--text", "--muted", "--border", "--border-strong", "--accent", "--on-accent", "--fit", "--wait", "--gap", "--tie", "--stub"];
export const colorCss = (read, dark) => `:root{color-scheme:${dark ? "dark" : "light"};${COLOR_VARS.map((n) => `${n}:${String(read(n) ?? "").replace(/[;{}<>]/g, "")}`).join(";")}}`;

// The document for the frame's srcdoc: the colours, the shell's own styles (css), the page inside .pv.
export function thumbDoc(fragment, css, colors) {
  const safeCss = `${colors}\n${String(css ?? "")}`.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${safeCss}
html,body{margin:0;overflow:hidden;background:var(--surface)}body{width:${THUMB.pageW}px;height:${Math.round(THUMB.pageW * THUMB.ratio)}px;padding:24px 28px;font-size:15px}*{pointer-events:none!important}</style></head><body><div class="pv">${fragment ?? ""}</div></body></html>`;
}
