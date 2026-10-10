// A wireframe of the page for the Page map: the same tree as the inventory, drawn as plain HTML where EVERY element and
// text node carries `data-pm-id`, so hovering or clicking a box in the browser maps to a tree node by construction (no
// guessing from source positions). It is not the design: components become boxes, and only a few layout hints are read
// (Tailwind `flex` / `flex-col`, tables). Pure and deterministic; the page (src/ui/pagemap.mjs) colours the boxes by class.
//
// Why not /api/preview: that renderer draws only the first JSX root of a plain-HTML page, skips components and
// attribute text and gives text nodes no ids, so it cannot be mapped node by node. It stays as the "Original preview" tab.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SAFE = /^(h[1-6]|p|ul|ol|li|nav|header|footer|main|section|article|aside|form|label|a|span|div|b|i|strong|em|small|figure|figcaption|details|summary|blockquote)$/;
const VOID_LIKE = /^(input|select|textarea|img|svg|canvas|progress|iframe|video|audio|picture)$/;

const flexClass = (cls) => {
  const t = String(cls ?? "").split(/\s+/);
  if (t.includes("flex-col") || t.includes("flex-col-reverse")) return " pm-fc";
  if (t.includes("flex") || t.includes("inline-flex")) return " pm-fr";
  if (t.includes("grid")) return " pm-fg";
  return "";
};

// Tailwind's default spacing scale: 1 unit = 4px. Only these tokens are recognised (no arbitrary values like gap-[13px]).
const SPACING_PX = Object.fromEntries([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96].map((n) => [String(n), n * 4]));

/**
 * Read gap/padding/flex-wrap Tailwind utilities from a box's className.
 * @param {string} [cls]
 * @returns {{ gapX?: number, gapY?: number, padT?: number, padR?: number, padB?: number, padL?: number, wrap?: "wrap"|"wrap-reverse"|"nowrap" }}
 */
const spacingOf = (cls) => {
  const t = String(cls ?? "").split(/\s+/);
  const out = {};
  const px = (n) => SPACING_PX[n];
  for (const token of t) {
    let m;
    if ((m = /^gap-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) { out.gapX = px(m[1]); out.gapY = px(m[1]); }
    else if ((m = /^gap-x-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.gapX = px(m[1]);
    else if ((m = /^gap-y-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.gapY = px(m[1]);
    else if ((m = /^p-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) { out.padT = out.padR = out.padB = out.padL = px(m[1]); }
    else if ((m = /^px-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) { out.padR = out.padL = px(m[1]); }
    else if ((m = /^py-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) { out.padT = out.padB = px(m[1]); }
    else if ((m = /^pt-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.padT = px(m[1]);
    else if ((m = /^pr-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.padR = px(m[1]);
    else if ((m = /^pb-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.padB = px(m[1]);
    else if ((m = /^pl-(\d+(?:\.\d+)?)$/.exec(token)) && px(m[1]) !== undefined) out.padL = px(m[1]);
    else if (token === "flex-wrap") out.wrap = "wrap";
    else if (token === "flex-wrap-reverse") out.wrap = "wrap-reverse";
    else if (token === "flex-nowrap") out.wrap = "nowrap";
  }
  return out;
};

/**
 * Render the spacing read by `spacingOf` as an inline style string plus `data-pm-*` attributes
 * (so tests can assert on the raw values without parsing `style`). Empty string when none found.
 * @param {ReturnType<typeof spacingOf>} sp
 */
const spacingAttrs = (sp) => {
  const style = [];
  const data = [];
  if (sp.gapX !== undefined || sp.gapY !== undefined) {
    const gx = sp.gapX ?? 0, gy = sp.gapY ?? 0;
    style.push(gx === gy ? `gap:${gx}px` : `column-gap:${gx}px;row-gap:${gy}px`);
    data.push(`data-pm-gap="${gx === gy ? `${gx}` : `${gx} ${gy}`}"`);
  }
  if ([sp.padT, sp.padR, sp.padB, sp.padL].some((v) => v !== undefined)) {
    const pt = sp.padT ?? 0, pr = sp.padR ?? 0, pb = sp.padB ?? 0, pl = sp.padL ?? 0;
    style.push(`padding:${pt}px ${pr}px ${pb}px ${pl}px`);
    data.push(`data-pm-pad="${pt} ${pr} ${pb} ${pl}"`);
  }
  if (sp.wrap) {
    style.push(`flex-wrap:${sp.wrap}`);
    data.push(`data-pm-wrap="${sp.wrap}"`);
  }
  if (!style.length) return "";
  return ` style="${style.join(";")}" ${data.join(" ")}`;
};

/**
 * Draw the inventory as wireframe HTML (a fragment, no document wrapper).
 *
 * @param {ReturnType<typeof import("./inventory.mjs").buildInventory>} inv The inventory.
 * @returns {string} HTML; every box has `data-pm-id`, `data-pm-kind` and `data-pm-tag`.
 */
export function wireframe(inv) {
  const { byId } = inv;
  const draw = (id) => {
    const n = byId.get(id);
    const ids = `data-pm-id="${n.id}"`;
    if (n.kind === "text") {
      if (n.textKind === "attribute") return `<span class="pm-a" ${ids} data-pm-kind="text" title="${esc(n.attr)}"><i>${esc(n.attr)}</i> ${esc(n.text)}</span>`;
      return `<span class="pm-t${n.textKind === "expression" ? " pm-x" : ""}" ${ids} data-pm-kind="text">${esc(n.textKind === "expression" ? `{${n.text}}` : n.text)}</span>`;
    }
    const kids = n.children.map(draw).join("");
    const attrs = `${ids} data-pm-kind="${n.kind}" data-pm-tag="${esc(n.tag)}"${spacingAttrs(spacingOf(n.props?.className))}`;
    const cls = `pm-e pm-k-${n.kind}${flexClass(n.props?.className)}`;
    const tag = /^[a-z]/.test(n.tag) && SAFE.test(n.tag) ? n.tag : "div";
    if (n.kind === "input") {
      const d = n.details;
      return `<span class="${cls} pm-inline" ${attrs}><em class="pm-label">${esc(d.label ?? d.name ?? d.tag)}</em><span class="pm-field">${esc(d.placeholder ?? d.defaultValue ?? d.inputType)}</span>${kids}</span>`;
    }
    if (n.kind === "visual" || n.kind === "media") {
      const label = n.details.subtype === "icon" ? "icon" : n.tag;
      return `<span class="${cls} pm-inline" ${attrs} title="${esc(n.tag)}"><span class="pm-glyph">${esc(label)}</span>${kids}</span>`;
    }
    if (VOID_LIKE.test(n.tag)) return `<span class="${cls} pm-inline" ${attrs}>${esc(n.tag)}${kids}</span>`;
    if (n.kind === "interaction") return `<${tag === "a" ? "a" : "span"} class="${cls} pm-inline pm-action" ${attrs} role="presentation">${kids}</${tag === "a" ? "a" : "span"}>`;
    return `<${tag} class="${cls}" ${attrs}>${kids}</${tag}>`; // table parts are divs; the page's CSS lays them out by data-pm-tag
  };
  return byId.get("root").children.map(draw).join("");
}
