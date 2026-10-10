// Renders the designed page as static HTML for the UI's preview panel. Every dynamic part gets a
// data-id that matches the tree's leaf ids (value.x, list.x, list.sort, action.row.x, form.x), so the UI
// can colour the page by connection state. Inputs and buttons are inert; the UI only uses them for hover and click.
import _traverse from "@babel/traverse";
import { parsePage, attr } from "./extract.mjs";

const traverse = _traverse.default ?? _traverse;
const VOID = new Set(["input", "br", "hr", "img"]);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SKIP_ATTRS = new Set(["data-dyn", "data-list", "data-action", "key", "ref", "style"]);
const RENAME = { className: "class", htmlFor: "for", defaultValue: "value" };

/**
 * Render a designed page's source as static HTML for the UI's preview panel. Every dynamic part gets a
 * `data-id` matching the match tree's leaf ids (`value.x`, `list.x`, `list.sort`, `action.row.x`/`action.page.x`,
 * `form.x`), so the UI can colour the page by connection state. Inputs and buttons are rendered inert
 * (`tabindex="-1"`; only used for hover/click by the UI, never interactive).
 *
 * @param {string} source The page's JSX/TSX source.
 * @returns {string} The rendered HTML for the page's root element, or `""` if it has none.
 */
export function renderPreview(source) {
  const ast = parsePage(source);
  let root = null;
  traverse(ast, { JSXElement(p) { root = p.node; p.stop(); } });
  return root ? render(root, { inList: false, inForm: false }) : "";
}

function render(el, ctx) {
  const tag = el.openingElement.name.name ?? "div";
  const dyn = attr(el, "data-dyn"), list = attr(el, "data-list"), action = attr(el, "data-action"), name = attr(el, "name");
  let id = null;
  if (list) id = "list.sort";
  else if (typeof dyn === "string") id = ctx.inList ? `list.${dyn}` : `value.${dyn}`;
  else if (typeof action === "string") id = `action.${ctx.inList ? "row" : "page"}.${action}`;
  else if (ctx.inForm && ["input", "select", "textarea"].includes(tag) && typeof name === "string") id = `form.${name}`;

  const attrs = [];
  for (const a of el.openingElement.attributes) {
    if (a.type !== "JSXAttribute" || a.name.type !== "JSXIdentifier") continue;
    const n = a.name.name;
    if (SKIP_ATTRS.has(n) || /^on[A-Z]/.test(n)) continue;
    let v = a.value?.type === "StringLiteral" ? a.value.value : a.value == null ? "" : a.value.expression?.type === "StringLiteral" ? a.value.expression.value : null;
    if (v === null) continue;
    if (n === "type" && v === "submit") v = "button";
    attrs.push(a.value == null ? RENAME[n] ?? n : `${RENAME[n] ?? n}="${esc(v)}"`);
  }
  if (id) attrs.push(`data-id="${esc(id)}"`);
  if (["input", "select", "textarea", "button"].includes(tag)) attrs.push("tabindex=\"-1\"");
  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
  if (VOID.has(tag)) return `${open}>`;

  const inner = { inList: ctx.inList || !!list, inForm: ctx.inForm || tag === "form" };
  const kids = el.children.map((c) => {
    if (c.type === "JSXText") return esc(c.value.replace(/\s+/g, " "));
    if (c.type === "JSXElement") return render(c, inner);
    if (c.type === "JSXExpressionContainer" && c.expression.type === "StringLiteral") return esc(c.expression.value);
    return "";
  });
  // A list is drawn from its own rows in the design (the first child is the template, the rest are examples).
  return `${open}>${kids.join("")}</${tag}>`;
}
