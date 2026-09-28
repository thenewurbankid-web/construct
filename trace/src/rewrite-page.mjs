// Page + Component layers — rewrite the designed JSX so the marked parts read from props.
// AST edits only (babel), no model.
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import { parsePage, attr, walk } from "./extract.mjs";
import { handlerName } from "./emit.mjs";

const traverse = _traverse.default ?? _traverse;
const generate = _generate.default ?? _generate;
const MARKERS = ["data-dyn", "data-list", "data-action"];

const expr = (code) => t.jsxExpressionContainer(parseExpr(code));
function parseExpr(code) {
  const ast = parsePage(`(${code});`);
  return ast.program.body[0].expression;
}
const setAttr = (node, name, valueCode) => {
  node.openingElement.attributes = node.openingElement.attributes.filter((a) => a.name?.name !== name);
  node.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), expr(valueCode)));
};
const stripMarkers = (node) => {
  walk(node, (n) => {
    n.openingElement.attributes = n.openingElement.attributes.filter((a) => !MARKERS.includes(a.name?.name));
  });
};
const tagName = (node) => node.openingElement.name.name;

/**
 * Rewrite the designed page's marked JSX so it reads its dynamic parts from props (Page layer), and, if it has a
 * repeated row, emit the row's own component (Component layer). AST edits only (Babel), no model.
 *
 * @param {string} source The designed page's JSX/TSX source.
 * @param {object} plan From `plan.mjs` `makePlan`.
 * @returns {{page: string, component: string|null}} The generated Page file's source, and the row Component's
 *   source (or `null` when the page has no list).
 */
export function rewritePage(source, plan) {
  const n = plan.names;
  const ast = parsePage(source);
  // Drop the designer's comments; the generated header replaces them.
  traverse(ast, { enter(p) { p.node.leadingComments = null; p.node.trailingComments = null; } });
  ast.comments = [];
  const staticParts = new Set([...plan.values.filter((v) => v.static).map((v) => v.name)]);
  const pageActions = plan.actions.filter((a) => a.scope === "page");
  const rowActions = plan.actions.filter((a) => a.scope === "row");
  let rowTemplate = null;

  traverse(ast, {
    JSXElement(path) {
      const node = path.node;
      const list = attr(node, "data-list");
      if (list) {
        rowTemplate = t.cloneNode(node.children.find((c) => c.type === "JSXElement"), true);
        const handlers = rowActions.map((a) => `${handlerName(a.name)}={${handlerName(a.name)}}`).join(" ");
        node.children = [
          expr(`rows.map((row) => <${n.Item}Row key={row.id} row={row} selected={row.id === selectedId} ${handlers} />)`),
        ];
        stripMarkers(node);
        path.skip();
        return;
      }
      const dyn = attr(node, "data-dyn");
      if (dyn && !staticParts.has(dyn)) node.children = [expr(dyn)];

      const action = attr(node, "data-action");
      const planned = action && pageActions.find((a) => a.name === action);
      if (planned) {
        const h = handlerName(action);
        if (tagName(node) === "form") {
          setAttr(node, "key", `selectedId ?? "new"`);
          setAttr(node, "onSubmit", `(e) => { e.preventDefault(); ${h}(Object.fromEntries(new FormData(e.currentTarget))); }`);
          walk(node, (el) => {
            const name = attr(el, "name");
            if (["input", "select", "textarea"].includes(tagName(el)) && typeof name === "string") {
              setAttr(el, "defaultValue", `formValues.${name} ?? ""`);
            }
          });
        } else {
          setAttr(node, "onClick", h);
        }
      }
      node.openingElement.attributes = node.openingElement.attributes.filter((a) => !MARKERS.includes(a.name?.name));
    },
  });

  // Props signature + loading/error slots on the page's root element.
  const props = ["status", "error"];
  for (const v of plan.values) if (!v.static) props.push(v.name);
  if (rowTemplate) props.push("rows", "selectedId");
  if (plan.form) props.push("formValues");
  if (!rowTemplate && plan.form) props.push("selectedId");
  for (const a of plan.actions) props.push(handlerName(a.name));

  traverse(ast, {
    ExportDefaultDeclaration(path) {
      const fn = path.node.declaration;
      if (!t.isFunctionDeclaration(fn)) return;
      fn.id = t.identifier(`${n.Feature}Page`);
      fn.params = [parseExpr(`({ ${[...new Set(props)].join(", ")} }) => 0`).params[0]];
      path.traverse({
        ReturnStatement(r) {
          const root = r.node.argument;
          if (!t.isJSXElement(root)) return;
          root.children.unshift(
            t.jsxText("\n"),
            expr(`status === "loading" && <p className="status">Loading…</p>`),
            t.jsxText("\n"),
            expr(`error && <p role="alert" className="error">{error}</p>`)
          );
          r.stop();
        },
      });
    },
  });

  const imports = rowTemplate ? `import ${n.Item}Row from "../component/${n.Item}Row.jsx";\n` : "";
  const header = "// Page layer — generated by line-matcher from the design. Props in, JSX out; no business logic.\n";
  const page = header + imports + "\n" + generate(ast, { jsescOption: { minimal: true } }).code;

  let component = null;
  if (rowTemplate) component = emitRowComponent(rowTemplate, plan);
  return { page, component };
}

function emitRowComponent(template, plan) {
  const n = plan.names;
  const staticParts = new Set(plan.rowFields.filter((f) => !f.field && !f.custom).map((f) => f.name));
  const rowActions = plan.actions.filter((a) => a.scope === "row");
  walk(template, (node) => {
    const dyn = attr(node, "data-dyn");
    if (dyn && !staticParts.has(dyn)) node.children = [expr(`row.${dyn}`)];
    const action = attr(node, "data-action");
    if (action && rowActions.some((a) => a.name === action)) {
      setAttr(node, "onClick", `() => ${handlerName(action)}(row.id)`);
    }
  });
  stripMarkers(template);
  template.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier("data-selected"), expr(`selected ? "true" : undefined`)));
  const params = ["row", "selected", ...rowActions.map((a) => handlerName(a.name))].join(", ");
  const body = generate(template, { jsescOption: { minimal: true } }).code;
  return `// Component layer — generated by line-matcher. Reusable presentation only.
export default function ${n.Item}Row({ ${params} }) {
  return (
    ${body}
  );
}
`;
}
