// Turns a parsed JSX tree into "nodes" (one per element) and builds a structural feature description for each
// candidate subtree. Deterministic: no literal user text is used as a signal, only tags, component names, roles,
// prop names, a few class names, child-tag sequences, sizes, depth and text-length buckets.

/** Tags that are strong, deterministic signals of a self-contained UI block. */
export const SEMANTIC_TAGS = new Set(["form", "header", "nav", "footer", "aside", "table", "dialog"]);
const SEMANTIC_ROLES = new Set(["banner", "navigation", "form", "complementary", "contentinfo", "dialog", "table", "grid", "search"]);
const INPUT_TAGS = new Set(["input", "select", "textarea"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const IMG_TAGS = new Set(["img", "svg", "picture", "video", "canvas"]);
const LIST_TAGS = new Set(["ul", "ol", "li", "dl", "dt", "dd"]);
const TABLE_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th"]);
const IGNORED_PROPS = new Set(["key", "className", "class", "style", "id", "ref"]);
const MAX_CLASSES = 3;
const MAX_SEQ = 8;
/** Bucket edges (element-count) for a direct child's size, used by the depth-normalised branch-shape signature. */
const BRANCH_SIZE_EDGES = [1, 2, 4, 8, 16];

function rng(n) {
  return n.range ?? [n.start, n.end];
}

function walk(node, parent, enter) {
  enter(node, parent);
  for (const [key, v] of Object.entries(node)) {
    if (key === "loc" || key === "range" || key === "extra" || key === "tokens" || key === "comments" || !v || typeof v !== "object") continue;
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && walk(c, node, enter));
    else if (typeof v.type === "string") walk(v, node, enter);
  }
}

/**
 * Flatten a parsed tree into per-element nodes with parent links, sizes, depth, text/dynamic-child counts,
 * enclosing component names and `.map()` origin.
 *
 * @param {{roots:object[], ast:object}} tree The result of `parseJsxTree`.
 * @param {string} source The source text the tree was parsed from.
 * @returns {{nodes: object[], byId: Map<string, object>, roots: object[]}} Nodes in document order. Each node has
 *   `{id, tag, isCustomComponent, props, start, end, line, endLine, parent, children, size, depth, textLen, dynCount,
 *   component, viaMap}` where `children`/`parent` are nodes, `size` counts elements including itself.
 */
export function buildNodes(tree, source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const nodes = [];
  const byId = new Map();
  const convert = (rec, parent, depth) => {
    const node = {
      id: rec.id, tag: rec.tag, isFragment: rec.isFragment, isCustomComponent: rec.isCustomComponent, props: rec.props,
      start: rec.start, end: rec.end, line: lineOf(rec.start), endLine: lineOf(Math.max(rec.start, rec.end - 1)),
      parent, children: [], size: 1, depth, textLen: 0, dynCount: 0, component: null, viaMap: false,
    };
    nodes.push(node);
    byId.set(node.id, node);
    for (const c of rec.children) node.children.push(convert(c, node, depth + 1));
    node.size = 1 + node.children.reduce((s, c) => s + c.size, 0);
    return node;
  };
  const roots = tree.roots.map((r) => convert(r, null, 0));
  nodes.sort((a, b) => a.start - b.start);

  const innermost = (offset) => {
    let best = null;
    for (const n of nodes) {
      if (n.start > offset) break;
      if (offset < n.end && (!best || n.start >= best.start)) best = n;
    }
    return best;
  };
  const components = [];
  const mapCallbacks = [];
  walk(tree.ast, null, (node, parent) => {
    const [s, e] = rng(node);
    if (node.type === "JSXText") {
      const len = node.value.trim().length;
      if (len) {
        const owner = innermost(s);
        if (owner) owner.textLen += len;
      }
    } else if (node.type === "JSXExpressionContainer" && parent && (parent.type === "JSXElement" || parent.type === "JSXFragment")) {
      const owner = innermost(s);
      if (owner) owner.dynCount += 1;
    } else if (node.type === "FunctionDeclaration" && node.id && /^[A-Z]/.test(node.id.name)) {
      components.push({ name: node.id.name, start: s, end: e });
    } else if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && /^[A-Z]/.test(node.id.name) && node.init) {
      components.push({ name: node.id.name, start: s, end: e });
    } else if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.arguments?.length) {
      const callee = node.callee;
      const prop = callee?.property;
      const cb = node.arguments[0];
      if ((callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") && prop?.type === "Identifier"
        && prop.name === "map" && /Function/.test(cb.type)) {
        mapCallbacks.push(rng(cb));
      }
    }
  });
  for (const n of nodes) {
    let best = null;
    for (const c of components) if (c.start <= n.start && n.end <= c.end && (!best || c.end - c.start < best.end - best.start)) best = c;
    n.component = best ? best.name : null;
  }
  for (const [cs, ce] of mapCallbacks) {
    for (const n of nodes) {
      const inside = (m) => m && m.start >= cs && m.end <= ce;
      if (inside(n) && !inside(n.parent)) n.viaMap = true;
    }
  }
  return { nodes, byId, roots };
}

/**
 * Every node in the subtree of `node`, including itself, in document order.
 *
 * @param {object} node A node from `buildNodes`.
 * @returns {object[]} The subtree's nodes.
 */
export function subtree(node) {
  const out = [];
  const go = (n) => {
    out.push(n);
    n.children.forEach(go);
  };
  go(node);
  return out;
}

/**
 * A node's string-valued prop, or null if it has none by that name (or the value isn't a plain string literal).
 *
 * @param {object} node A node from `buildNodes`.
 * @param {string} name Prop name.
 * @returns {string|null} The value, or null.
 */
export function propValue(node, name) {
  const p = node.props.find((x) => x.name === name);
  return p && p.kind === "string" ? String(p.value) : null;
}

/**
 * Whether a node is a semantic block (form, header, nav, footer, aside, table, dialog, or an ARIA landmark role).
 *
 * @param {object} node A node from `buildNodes`.
 * @returns {boolean} True for a semantic block.
 */
export function isSemantic(node) {
  return SEMANTIC_TAGS.has(node.tag) || SEMANTIC_ROLES.has(propValue(node, "role"));
}

function bucket(n, edges) {
  let i = 0;
  while (i < edges.length && n > edges[i]) i++;
  return i;
}

/**
 * Structural description of a subtree: weighted tokens (for the hashed embedder), a plain-English sentence
 * (for a text embedder) and summary facts (for the reason line).
 *
 * @param {object} node A node from `buildNodes`.
 * @returns {{tokens: Map<string, number>, text: string, facts: object}} Same input gives the same output.
 */
export function describe(node) {
  const all = subtree(node);
  const tokens = new Map();
  const add = (t, w) => tokens.set(t, (tokens.get(t) ?? 0) + w);
  const propNames = (n) => n.props.filter((p) => p.name && !IGNORED_PROPS.has(p.name)).map((p) => p.name);

  add(`tag:${node.tag}`, 2);
  if (node.isCustomComponent) add(`comp:${node.tag}`, 2);
  const role = propValue(node, "role");
  if (role) add(`role:${role}`, 2);
  const classes = (propValue(node, "className") ?? propValue(node, "class") ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES);
  for (const c of classes) add(`cls:${c}`, 1);
  for (const p of propNames(node)) add(`prop:${p}`, 1);
  const type = propValue(node, "type");
  if (type) add(`type:${type}`, 1);

  const childTags = node.children.map((c) => c.tag).slice(0, MAX_SEQ);
  if (childTags.length) add(`seq:${childTags.join(">")}`, 2);
  for (let i = 0; i + 1 < childTags.length; i++) add(`sib:${childTags[i]},${childTags[i + 1]}`, 1);
  // Two blocks can share the same shallow child-tag sequence while genuinely differing in shape -- e.g. a wrapper
  // that tucks its value and a caption into one extra <div> has the same "div, span, div, span"-ish outline as a
  // sibling wrapper that doesn't, and the raw tag sequence alone doesn't see the difference. Two more signals,
  // both coarse and content-blind (never literal text), catch that: the exact number of direct children, and a
  // depth-normalised "branch shape" -- each direct child's own subtree size, bucketed and in order, which is a
  // cheap proxy for "how much is inside branch 1 vs branch 2 vs ...". Two unrelated panels that happen to share a
  // tag sequence usually still differ in one of these; two genuine repeats (e.g. table rows, footer columns)
  // still match on both.
  add(`nchild:${node.children.length}`, 1);
  const branchShape = node.children.map((c) => bucket(c.size, BRANCH_SIZE_EDGES)).join(",");
  if (branchShape) add(`branch:${branchShape}`, 2);

  const counts = new Map();
  const flags = new Set();
  const handlers = new Set();
  let text = 0;
  let dyn = 0;
  for (const n of all) {
    if (n !== node) {
      counts.set(n.tag, (counts.get(n.tag) ?? 0) + 1);
      for (const c of n.children) add(`edge:${n.tag}>${c.tag}`, 0.5);
      for (const p of propNames(n)) {
        add(`dprop:${p}`, 0.5);
        if (/^on[A-Z]/.test(p)) handlers.add(p);
      }
    } else {
      for (const p of propNames(n)) if (/^on[A-Z]/.test(p)) handlers.add(p);
    }
    if (INPUT_TAGS.has(n.tag)) flags.add("inputs");
    if (n.tag === "button" || propValue(n, "role") === "button" || /Button$/.test(n.tag)) flags.add("buttons");
    if (HEADING_TAGS.has(n.tag)) flags.add("headings");
    if (IMG_TAGS.has(n.tag)) flags.add("images");
    if (n.tag === "a" || n.tag === "Link") flags.add("links");
    if (n.tag === "form") flags.add("form");
    if (LIST_TAGS.has(n.tag)) flags.add("list");
    if (TABLE_TAGS.has(n.tag)) flags.add("table");
    text += n.textLen;
    dyn += n.dynCount;
  }
  for (const [tag, c] of counts) add(`d:${tag}`, Math.sqrt(c));
  for (const f of [...flags].sort()) add(`has:${f}`, 1.5);
  const sizeBucket = bucket(node.size, [3, 6, 12, 25, 50]);
  const textBucket = bucket(text, [0, 20, 100, 400]);
  const dynBucket = bucket(dyn, [0, 2, 6]);
  add(`size:${sizeBucket}`, 1);
  add(`textlen:${textBucket}`, 0.5);
  add(`dyn:${dynBucket}`, 0.5);
  add(`depth:${Math.min(node.depth, 6)}`, 0.5);

  const sentence = [
    `${node.isCustomComponent ? "component" : "element"} ${node.tag}${role ? ` role ${role}` : ""}`,
    classes.length ? `classes ${classes.join(" ")}` : "",
    childTags.length ? `children ${childTags.join(", ")}` : "no children",
    flags.size ? `contains ${[...flags].sort().join(", ")}` : "",
    handlers.size ? `handlers ${[...handlers].sort().join(", ")}` : "",
    `${node.size} elements deep ${node.depth}`,
    `text ${["none", "short", "medium", "long", "very long"][textBucket]}`,
  ].filter(Boolean).join("; ");

  return { tokens, text: sentence, facts: { flags: [...flags].sort(), handlers: [...handlers].sort(), classes, inputs: counts.get("input") ?? 0, textLen: text } };
}
