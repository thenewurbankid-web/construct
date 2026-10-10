// What the DESIGN calls each dynamic part: the words a person reads next to it.
// Deterministic and pure (no model): it walks the same element tree extract() does and records, per part,
//   name    the designer's own name for it (data-dyn="openCount")
//   header  the column header (<th>) above a table cell, for row parts
//   inline  the text just before it in the same line ("largest open " in `largest open <b data-dyn=..>`)
//   label   the nearest text label above or before it (a card label such as <p class="label">Categories covered</p>)
// and, for the list, `list.header`: the first column's header, the noun for what a row is ("Project").
// src/evidence.mjs compares these words with the candidate field's name. Nothing here changes what extract() returns.
import { parsePage, attrOf } from "./import/parse.mjs";
import { kids, textOf } from "./import/extract-parts.mjs";

const within = (inner, outer) => inner !== outer && inner.start >= outer.start && inner.end <= outer.end;
const hasDyn = (el) => !!attrOf(el, "data-dyn") || kids(el).some((c) => c.kind === "element" && hasDyn(c));
const words = (s) => (/[A-Za-z#]/.test(s) ? s.replace(/\s+/g, " ").trim() : "");

// The text right before `el` in its parent (no element in between).
function inlineBefore(el) {
  if (!el.parent) return "";
  const sibs = kids(el.parent);
  const i = sibs.indexOf(el);
  const prev = sibs[i - 1];
  return prev?.kind === "text" ? words(prev.text).split(" ").slice(-3).join(" ") : ""; // the last three words: what sits right next to it
}

// The closest label above or before `el`: the previous sibling element (one that holds no data itself) at
// the element's own level, or at one of its ancestors' levels, up to `stop`.
function labelBefore(el, stop) {
  let cur = el;
  for (let depth = 0; depth < 3 && cur && cur !== stop; depth++) {
    if (!cur.parent) break;
    const sibs = kids(cur.parent);
    let i = sibs.indexOf(cur) - 1;
    for (; i >= 0; i--) {
      const s = sibs[i];
      if (s.kind === "element" && !hasDyn(s) && words(textOf(s))) return words(textOf(s));
      if (s.kind === "element" && hasDyn(s)) break; // another data part sits in between: not this part's label
    }
    cur = cur.parent;
  }
  return "";
}

/**
 * The design's words for every dynamic part of a page.
 *
 * @param {string} source Page source (JSX or TSX).
 * @returns {{values: Object<string, {name:string, inline:string, label:string}>, fields: Object<string, {name:string, header:string, inline:string, label:string}>}}
 *   `values` by data-dyn name (outside the first list); `fields` by data-dyn name in the first list's row.
 *
 * @example
 * designLabels('<div><p>Open</p><b data-dyn="n">3</b></div>').values.n.label; // => "Open"
 */
export function designLabels(source) {
  const page = parsePage(source);
  const els = page.elements.filter((e) => e.kind === "element");
  const lists = els.filter((e) => attrOf(e, "data-list"));
  const out = { values: {}, fields: {}, list: { name: "", header: "" } };
  const list = lists[0];
  if (list) {
    const rows = kids(list).filter((c) => c.kind === "element");
    const row = rows[0];
    const table = els.filter((e) => e.tag === "table" && within(list, e))[0];
    const headers = table ? els.filter((e) => e.tag === "th" && within(e, table)).map((th) => words(textOf(th))) : [];
    const cells = row ? kids(row).filter((c) => c.kind === "element") : [];
    out.list = { name: attrOf(list, "data-list") || "", header: headers.find(Boolean) ?? "" };
    for (const el of els.filter((e) => row && within(e, row) && attrOf(e, "data-dyn"))) {
      const name = attrOf(el, "data-dyn");
      if (name in out.fields) continue;
      const cell = cells.findIndex((c) => c === el || within(el, c));
      out.fields[name] = { name, header: cell >= 0 ? headers[cell] ?? "" : "", inline: inlineBefore(el), label: labelBefore(el, row) };
    }
  }
  for (const el of els) {
    const name = attrOf(el, "data-dyn");
    if (!name || lists.some((l) => within(el, l))) continue;
    if (!(name in out.values)) out.values[name] = { name, inline: inlineBefore(el), label: labelBefore(el, null) };
  }
  return out;
}
