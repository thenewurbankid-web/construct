// Step 1 on a parser-neutral tree: find the dynamic parts the designer marked (data-dyn, data-list, data-action).
// This is the logic that used to live in src/extract.mjs on Babel nodes; the output shape is unchanged
// (the 11 examples' extraction is pinned by a golden hash in golden.test.mjs). What is new is only what the
// tree can now express: TypeScript syntax, member tags (`Table.Row`), fragments and `{"text"}` children.
import { parsePage, attrOf } from "./parse.mjs";

/**
 * An element's children as the extractor sees them: a fragment is transparent (its children count as the parent's).
 *
 * @param {import("./parse.mjs").ElementNode} el The element.
 * @returns {(import("./parse.mjs").ElementNode|import("./parse.mjs").TextNode|{kind:"expr"})[]} Text, element and opaque-expression children in order.
 */
export function kids(el) {
  return el.children.flatMap((c) => (c.kind === "fragment" ? kids(c) : [c]));
}

/**
 * The visible text of an element: its text (including `{"literal"}` and plain template literals) and its
 * child elements' text, whitespace collapsed. Other expressions (`{value}`) contribute nothing.
 *
 * A `prefix`/`suffix` string prop on the element itself is also visible text (Subframe's `MetricCard.Value`
 * renders `prefix + children + suffix` as one number, e.g. `<MetricCard.Value suffix="M">$280</MetricCard.Value>`
 * reads as "$280M"). Without this, a suggestion or extraction on that element silently drops the suffix/prefix
 * and reports the wrong magnitude (see docs/README "Text passed as a string prop").
 *
 * @param {import("./parse.mjs").ElementNode} el The element.
 * @returns {string} The collapsed text.
 */
export function textOf(el) {
  // Collapse/trim the children's own text FIRST, so a multi-line child (whitespace before the closing tag)
  // doesn't leave a stray space between it and an appended suffix (`$280` + suffix "M" must read "$280M", not
  // "$280 M").
  const inner = kids(el)
    .map((c) => (c.kind === "text" ? c.text : c.kind === "element" ? textOf(c) : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const prefix = attrOf(el, "prefix");
  const suffix = attrOf(el, "suffix");
  return `${typeof prefix === "string" ? prefix : ""}${inner}${typeof suffix === "string" ? suffix : ""}`.replace(/\s+/g, " ").trim();
}

// Walk elements under `el` (inclusive) through child elements only; slots inside props and `{...}` are not entered.
function walkKids(el, fn) {
  if (el?.kind !== "element") return;
  fn(el);
  kids(el).forEach((c) => walkKids(c, fn));
}

const elementKids = (el) => kids(el).filter((c) => c.kind === "element");
const within = (inner, outer) => inner !== outer && inner.start >= outer.start && inner.end <= outer.end;
const VISUAL_TAGS = ["svg", "canvas", "progress", "img", "iframe"];

/**
 * Extract the marked dynamic parts from a page.
 *
 * @param {string|import("./parse.mjs").Page} pageOrSource Page source (JSX or TSX) or an already parsed page.
 * @returns {{values:object[], lists:object[], actions:object[], forms:object[], visuals:object[]}} The parts:
 *   `values {name, example}`, `lists {name, fields, rows, actions}`, `actions {name, element}`,
 *   `forms {action, fields}`, `visuals {tag, where}`.
 * @throws {Error} When the source is not valid JSX/TSX.
 *
 * @example
 * extractParts('export default () => <b data-dyn="n">7</b>;').values; // => [{ name: "n", example: "7" }]
 */
export function extractParts(pageOrSource) {
  const page = typeof pageOrSource === "string" ? parsePage(pageOrSource) : pageOrSource;
  const found = { values: [], lists: [], actions: [], forms: [], visuals: [] };
  const els = page.elements.filter((e) => e.kind === "element");

  const listNodes = els.filter((e) => attrOf(e, "data-list"));
  for (const node of listNodes) {
    const rows = elementKids(node);
    const rowValues = rows.map((row) => {
      const vals = {};
      walkKids(row, (n) => {
        const k = attrOf(n, "data-dyn");
        if (k) vals[k] = textOf(n);
      });
      return vals;
    });
    const rowActions = [];
    walkKids(rows[0], (n) => {
      const a = attrOf(n, "data-action");
      if (a) rowActions.push(a);
    });
    found.lists.push({ name: attrOf(node, "data-list"), fields: Object.keys(rowValues[0] ?? {}), rows: rowValues, actions: rowActions });
  }

  // Values and actions outside lists
  for (const node of els) {
    if (listNodes.some((l) => within(node, l))) continue;
    const dyn = attrOf(node, "data-dyn");
    if (dyn) found.values.push({ name: dyn, example: textOf(node) });
    const action = attrOf(node, "data-action");
    if (action) {
      found.actions.push({ name: action, element: node.tag });
      if (node.tag === "form") {
        const fields = [];
        walkKids(node, (el) => {
          const n = attrOf(el, "name");
          if (["input", "select", "textarea"].includes(el.tag) && typeof n === "string") {
            fields.push({ name: n, type: attrOf(el, "type") || "text" });
          }
        });
        found.forms.push({ action, fields });
      }
    }
  }

  // Charts, sparklines, progress bars and images carry no data marker: someone has to supply their data and build them.
  if (page.root) {
    const headers = [];
    walkKids(page.root, (el) => { if (el.tag === "th") headers.push(textOf(el)); });
    const visit = (el, col) => {
      if (VISUAL_TAGS.includes(el.tag)) found.visuals.push({ tag: el.tag, where: col != null && headers[col] ? `the "${headers[col]}" column` : "the page" });
      else elementKids(el).forEach((c, i) => visit(c, el.tag === "tr" ? i : col));
    };
    visit(page.root, null);
  }
  return found;
}
