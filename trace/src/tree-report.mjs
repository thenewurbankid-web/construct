// The finished tree as one self-contained HTML file (REPORT.html): inline SVG + CSS, no scripts.
import { buildTree } from "./tree/model.mjs";
import { layoutTree, markup, layersMarkup, THEME_CSS, TREE_CSS } from "./tree/svg.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Render the match tree as one self-contained HTML report (inline SVG + CSS, no scripts) — `REPORT.html`.
 *
 * @param {object} m The match result.
 * @param {{feature: string, contract?: {notice?: string}}} spec The example's spec.
 * @param {object|null} [layers] Generated-layers data (see `tree/svg.mjs` `layersMarkup`); when given, a
 *   "Generated layers" section is appended.
 * @returns {string} The complete HTML document.
 */
export function renderTreeHtml(m, spec, layers = null) {
  const tree = buildTree(m, spec);
  const layout = layoutTree(tree);
  const { total, missing, placeholder } = tree.stats;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(spec.feature)} — match tree</title>
<style>
${THEME_CSS}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 16px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 16px;font-size:13px;color:var(--mut)}
.legend i{display:inline-block;width:22px;height:12px;border-radius:4px;vertical-align:-2px;margin-right:6px;border:1.5px solid var(--bd2);background:var(--card)}
.legend i.m{border:1.5px dashed var(--red);background:var(--redbg)}.legend i.p{border:1.5px dashed var(--ph);background:var(--phbg)}.legend i.s{background:var(--stat);border-style:dashed}
.scroll{overflow-x:auto;border:1px solid var(--bd);border-radius:10px;background:var(--card);padding:12px}
svg{display:block;min-width:${layout.width}px}
${TREE_CSS}
</style></head><body><main>
<h1>${esc(spec.feature)} — how the design connects to the API</h1>
${spec.contract?.notice ? `<p style="border:1.5px dashed var(--red);background:var(--redbg);color:var(--red);border-radius:10px;padding:8px 12px;margin:0 0 16px;font-weight:600">${esc(spec.contract.notice)}</p>\n` : ""}<p class="sub">${total - missing - placeholder} of ${total} connections complete${placeholder ? ` · <b style="color:var(--ph)">${placeholder} placeholders</b>` : ""}${missing ? ` · <b style="color:var(--red)">${missing} missing</b>` : ""}. Read left to right: what the design shows, how it is computed, where the data comes from.</p>
<div class="legend"><span><i></i>connected</span><span><i class="s"></i>static (kept from design)</span><span><i class="p"></i>placeholder to build</span><span><i class="m"></i>missing node or path</span></div>
<div class="scroll">${markup(layout)}</div>
<p class="sub" style="margin-top:12px">Paths: <b style="color:var(--grn)">green</b> connected · <b>grey dotted</b> static · <b style="color:var(--amb)">amber dotted</b> needs an answer · <b style="color:var(--ph)">violet dashed</b> placeholder · <b style="color:var(--red)">red dashed</b> missing. Each node shows the generated layer it lands in; <i>ƒ</i> marks a transform.</p>
${layers ? `<h2 style="font-size:16px;margin:20px 0 8px">Generated layers</h2>${layersMarkup(layers)}` : ""}
</main></body></html>
`;
}
