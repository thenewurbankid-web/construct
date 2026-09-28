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
    const attrs = `${ids} data-pm-kind="${n.kind}" data-pm-tag="${esc(n.tag)}"`;
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
