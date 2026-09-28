// The Page map's inventory: the FULL node tree of a designed page (JSX or TSX). Every element and every text node
// (JSX text, `{"..."}`, template literals without expressions, and text that only lives in an attribute: alt,
// aria-label, title, placeholder, label, helpText), each with a stable id, a kind and the details a reviewer needs.
// Pure and deterministic: no model, no I/O, no clock, no randomness. Same source and file name give the same ids and
// the same tree, byte for byte. Built on the import block's parser-neutral tree (src/import/), which in turn runs on
// Construct's AST package when CONSTRUCT_ROOT is set and on Trace's Babel fallback otherwise (see src/construct.mjs).
//
// Kinds: text | interaction | input | list | table | row | cell | media | visual | container
//   text         any text node; details say whether it is a literal, an expression or attribute text (a11y flag)
//   interaction  a button, link, form or anything with a handler (onClick, onSubmit, href, type=submit)
//   input        input/select/textarea and component fields (TextField, Select, Checkbox, Switch ...)
//   list         an element whose children are repeated rows (data-list, 3+ same-shaped siblings, a `.map()`)
//   table/row/cell  the table tags (Table, Table.Row, Table.Cell, Table.HeaderCell, table, tr, td, th)
//   media        img, Avatar, icons; visual: svg, canvas, progress, iframe, charts
//   container    everything else (layout)
import { parsePage, attrOf, textOf } from "../import/index.mjs";
import { sha1, shapeOf, shapeHash, shapeKids, repeatRuns } from "./shape.mjs";
import { detectStates } from "./states.mjs";

/** Attributes whose string value is text a person reads or hears. */
export const A11Y_ATTRS = ["alt", "aria-label", "title", "placeholder"];
/** Component props that hold visible text (labels of fields). Not flagged a11y. */
export const PROP_TEXT_ATTRS = ["label", "helpText"];

const TABLE = /^(Table|table)$/;
const ROW = /(^tr$)|(^Table\.Row$)|(HeaderRow$)/;
const HEADER_ROW = /(HeaderRow$)/;
const HEADER_CELL = /(^th$)|(HeaderCell$)/;
const CELL = /(^td$)|(^th$)|(^Table\.Cell$)|(HeaderCell$)/;
const INPUT = /^(input|select|textarea|Input|TextField|Select|TextArea|Textarea|Checkbox|Switch|RadioGroup|Radio|ToggleGroup|Slider|DatePicker|Combobox|SegmentedControl)$/;
const BUTTON = /^(Button|IconButton|button)$/;
const VISUAL = /^(svg|canvas|progress|iframe|Progress|Sparkline|\w*Chart)$/;
const MEDIA = /^(img|Image|Avatar|picture|video|audio)$/;
const ICON = /^(Feather\w+|Icon\w*|Logo\w*)$/;
const OPTION = /^(option|Select\.Item|SelectItem|Select\.Option|RadioGroup\.Option|ToggleGroup\.Item)$/;
const NAV_ITEM = /(NavItem|Tabs?\.Item|Breadcrumbs\.Item|Menu\.Item|\w+Menu\.\w*Item)$/;
const SKIP_TEXT_TAG = /^(script|style)$/;

// The verbs suggestMarkers knows for a button label (src/import/suggest-markers.mjs KNOWN_VERBS); kept in step by a test.
const KNOWN_VERBS = { create: "create", add: "create", new: "create", update: "update", save: "save", submit: "submit", delete: "delete", remove: "delete", edit: "edit", select: "select", open: "open", cancel: "cancel", reset: "reset", close: "close", refresh: "refresh", reload: "refresh" };
export const collapseWs = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const words = (s) => collapseWs(s).match(/[A-Za-z0-9]+/g) ?? [];
/** camelCase name from the first `n` words of a label. */
export const camel = (s, n = 4) => words(s).slice(0, n).map((x) => x.toLowerCase()).map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join("");
/** The action verb a button label suggests (`Save changes` -> `save`, `Prompt suggestion 01` -> `promptSuggestion`). */
export const verbOf = (label) => KNOWN_VERBS[(words(label)[0] ?? "").toLowerCase()] ?? (camel(label, 3) || "action");

/**
 * @typedef {object} PmNode
 * @property {string} id            stable id: hash of file + line:col + tag path (never random)
 * @property {string|null} parent
 * @property {"text"|"interaction"|"input"|"list"|"table"|"row"|"cell"|"media"|"visual"|"container"} kind
 * @property {string} tag           element tag (`Table.Row`), or `#text` for a text node, `#page` for the virtual root
 * @property {number} line          1-based
 * @property {number} col           1-based
 * @property {number} start         source offset (elements: the `<`; text: the first non-space character; attribute text: the attribute)
 * @property {number} end
 * @property {number} depth
 * @property {string} path          tag path from the page root, e.g. `div>Table>Table.Row`
 * @property {string[]} children    ids in source order
 * @property {string} [slot]        set when the element sits in a prop (`mainMenu`) or a `{...}` expression: `{kind, name?, map, cond}`
 * @property {object} [props]       element attributes: the string for `name="x"`, `true` for anything else
 * @property {string} [text]        text nodes: the collapsed text (for an expression: its source)
 * @property {"jsx"|"literal"|"template"|"expression"|"attribute"} [textKind]
 * @property {string} [attr]        attribute text: the attribute name
 * @property {boolean} [a11y]       attribute text of alt/aria-label/title/placeholder
 * @property {object} [spans]       elements: `{tagEnd, attrs:[{name,start,end}]}` offsets, for writing attributes
 * @property {object} details       per kind, see the module header
 * @property {string} [shape]       shape hash (elements)
 */

/**
 * Build the inventory of a page.
 *
 * @param {string} source JSX or TSX module text.
 * @param {{file?:string}} [opts] `file` is part of every id (a page's ids differ from another file's).
 * @returns {{file:string, nodes:PmNode[], byId:Map<string,PmNode>, root:string, counts:object, groups:object[], states:object[]}}
 *   `nodes` in document order (the virtual root first); `groups` are the repeated runs (see collapse.mjs); `states` the
 *   state records (conditionals, disabled/selected/loading/empty/error), see states.mjs.
 * @throws {Error} On a syntax error (the parser's message).
 *
 * @example
 * buildInventory('export default () => <p>Hi <b>$5</b></p>;', { file: "p.jsx" }).nodes.filter((n) => n.kind === "text").length; // => 2
 */
export function buildInventory(source, { file = "page.jsx" } = {}) {
  const page = parsePage(source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const locOf = (offset) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
  };
  const recs = page.elements;
  const owner = (rec) => { let p = rec.parent; while (p && p.kind === "fragment") p = p.parent; return p; };
  const isMapSrc = (s) => /\.(map|flatMap)\s*\(/.test(s);
  const isCondSrc = (s) => /(&&|\?[^.?]|\|\|)/.test(s);
  const anyRecIn = (from, to) => recs.some((r) => r.start >= from && r.end <= to);

  // ---- 1. items per owner element (null = the page) ----
  const items = new Map(); // owner rec -> [{t, start, ...}]
  const push = (o, it) => { if (!items.has(o)) items.set(o, []); items.get(o).push(it); };
  const ranges = new Map(); // owner rec -> [{start,end,via}] the slots and expressions that contain elements
  const addRange = (o, r) => { if (!ranges.has(o)) ranges.set(o, []); ranges.get(o).push(r); };
  for (const rec of recs) {
    const o = rec.kind === "element" ? rec : owner(rec);
    if (rec.kind === "element") {
      for (const a of rec.attrs) {
        const src = source.slice(a.start, a.end);
        if (anyRecIn(a.start, a.end)) addRange(rec, { start: a.start, end: a.end, via: { kind: "slot", name: a.name, map: isMapSrc(src), cond: isCondSrc(src), src, start: a.start, end: a.end } });
      }
    }
    for (const c of rec.children) {
      if (c.kind === "text") {
        if (c.text.trim() && !SKIP_TEXT_TAG.test(rec.tag)) push(o, { t: "text", start: c.start, c, rec });
      } else if (c.kind === "expr") {
        const src = source.slice(c.start, c.end);
        const inner = src.slice(1, -1).trim();
        if (!inner || /^\/\*[\s\S]*\*\/$/.test(inner)) continue; // {} or a comment
        if (anyRecIn(c.start, c.end)) addRange(o, { start: c.start, end: c.end, via: { kind: "expr", map: isMapSrc(src), cond: isCondSrc(src), src, start: c.start, end: c.end } });
        else push(o, { t: "expr", start: c.start, c, inner });
      }
    }
  }
  for (const rec of recs) if (rec.kind === "element") {
    push(owner(rec), { t: "el", start: rec.start, rec });
    for (const a of rec.attrs) {
      if (!A11Y_ATTRS.includes(a.name) && !PROP_TEXT_ATTRS.includes(a.name)) continue;
      const src = source.slice(a.start, a.end);
      const lit = typeof a.value === "string" ? { text: a.value, textKind: "attribute" } : literalAttr(src, a.name);
      if (lit) push(rec, { t: "attr", start: a.start, a, rec, ...lit });
      else if (a.value === true && src.includes("=")) push(rec, { t: "attr", start: a.start, a, rec, text: src.slice(src.indexOf("=") + 1).replace(/^\{|\}$/g, "").trim(), textKind: "expression", dynamic: true });
    }
  }
  for (const list of items.values()) list.sort((a, b) => a.start - b.start || (a.t === "el" ? -1 : 1));

  // ---- 2. node records, in document order ----
  const nodes = [];
  const byId = new Map();
  const used = new Set();
  const mkId = (key) => {
    let n = 8, id;
    do { id = "n" + sha1(key).slice(0, n); n += 2; } while (used.has(id));
    used.add(id);
    return id;
  };
  const add = (node) => { nodes.push(node); byId.set(node.id, node); if (node.parent) byId.get(node.parent).children.push(node.id); return node; };
  const root = add({ id: "root", parent: null, kind: "container", tag: "#page", line: 1, col: 1, start: 0, end: source.length, depth: 0, path: "", children: [], details: { virtual: true } });
  const viaOf = (rec, o) => {
    const own = ranges.get(o) ?? [];
    return own.find((r) => rec.start >= r.start && rec.end <= r.end)?.via ?? null;
  };
  const build = (o, parentNode, pathNames) => {
    for (const it of items.get(o) ?? []) {
      if (it.t === "el") {
        const rec = it.rec;
        const path = [...pathNames, rec.tag];
        const via = viaOf(rec, o);
        const props = Object.fromEntries(rec.attrs.map((a) => [a.name, a.value]));
        const node = add({
          id: mkId(`${file}|${rec.line}:${rec.column}|${path.join(">")}`), parent: parentNode.id, kind: "container", tag: rec.tag,
          line: rec.line, col: rec.column, start: rec.start, end: rec.end, depth: parentNode.depth + 1, path: path.join(">"), children: [],
          ...(via ? { slot: via.kind === "slot" ? via.name : "{}", via } : {}), props, details: {},
          spans: { tagEnd: rec.start + 1 + rec.tag.length, attrs: rec.attrs.map((a) => ({ name: a.name, start: a.start, end: a.end })) }, // where an attribute would be inserted (apply.mjs); not sent to the browser
        });
        build(rec, node, path);
      } else if (it.t === "text") {
        const c = it.c, raw = source.slice(c.start, c.end);
        const lead = c.fromExpr ? 0 : raw.length - raw.trimStart().length;
        const ts = c.start + lead, te = c.fromExpr ? c.end : ts + raw.trim().length;
        const loc = locOf(ts);
        const path = [...pathNames, "#text"];
        add({
          id: mkId(`${file}|${loc.line}:${loc.col}|${path.join(">")}`), parent: parentNode.id, kind: "text", tag: "#text", line: loc.line, col: loc.col,
          start: ts, end: te, depth: parentNode.depth + 1, path: path.join(">"), children: [],
          text: collapseWs(c.text), textKind: !c.fromExpr ? "jsx" : /^\s*`/.test(source.slice(c.start + 1, c.end - 1)) ? "template" : "literal", details: {},
        });
      } else if (it.t === "expr") {
        const loc = locOf(it.c.start);
        const path = [...pathNames, "#expr"];
        add({
          id: mkId(`${file}|${loc.line}:${loc.col}|${path.join(">")}`), parent: parentNode.id, kind: "text", tag: "#text", line: loc.line, col: loc.col,
          start: it.c.start, end: it.c.end, depth: parentNode.depth + 1, path: path.join(">"), children: [],
          text: it.inner, textKind: "expression", details: { dynamic: true },
        });
      } else if (it.t === "attr") {
        const loc = locOf(it.a.start);
        const path = [...pathNames, `@${it.a.name}`];
        add({
          id: mkId(`${file}|${loc.line}:${loc.col}|${path.join(">")}`), parent: parentNode.id, kind: "text", tag: "#text", line: loc.line, col: loc.col,
          start: it.a.start, end: it.a.end, depth: parentNode.depth + 1, path: path.join(">"), children: [],
          text: collapseWs(it.text), textKind: it.textKind, attr: it.a.name, ...(A11Y_ATTRS.includes(it.a.name) ? { a11y: true } : {}), details: it.dynamic ? { dynamic: true } : {},
        });
      }
    }
  };
  build(null, root, []);
  const recOf = new Map(); // node id -> parser record, for details (the extractor's own text reading)
  const recByPos = new Map(recs.filter((r) => r.kind === "element").map((r) => [`${r.line}:${r.column}:${r.tag}`, r]));
  for (const n of nodes) if (n.kind !== "text" && n.id !== "root") recOf.set(n.id, recByPos.get(`${n.line}:${n.col}:${n.tag}`));

  // ---- 3. shapes, kinds, details ----
  const memo = new Map();
  for (const n of nodes) if (n.kind !== "text" && n.id !== "root") n.shape = shapeHash(shapeOf(byId, n, memo));
  const desc = (n, pred, out = []) => { for (const id of n.children) { const c = byId.get(id); if (pred(c)) out.push(c); desc(c, pred, out); } return out; };
  const ownTexts = (n) => n.children.map((id) => byId.get(id)).filter((c) => c.kind === "text" && c.textKind !== "attribute").map((c) => c.text);
  const textIn = (n) => collapseWs(recOf.get(n.id) ? textOf(recOf.get(n.id)) : "");
  const prop = (n, name) => (typeof n.props?.[name] === "string" ? n.props[name] : null);
  const propSrc = (n, name) => { const a = recOf.get(n.id)?.attrs.find((x) => x.name === name); return a ? source.slice(a.start, a.end) : null; };
  const hasFlag = (n, name) => n.props?.[name] !== undefined && !/=\{\s*false\s*\}$/.test(propSrc(n, name) ?? "");
  const iconName = (n) => { const s = propSrc(n, "icon"); const m = s && s.match(/Feather(\w+)|<(\w+)/); return m ? words((m[1] ?? m[2].replace(/^Feather/, "")).replace(/([a-z])([A-Z])/g, "$1 $2")).join(" ") : ""; };
  const labelOf = (n) => textIn(n) || prop(n, "aria-label") || prop(n, "title") || prop(n, "label") || iconName(n) || "";
  // Subframe's tap-target idiom (matches src/import/suggest-markers.mjs's own guard, so both agree on "one implementation"):
  // a row/card marked `clickable` is itself the action when nothing inside it already has its own onClick/submit.
  const isBtnTag = (m) => BUTTON.test(m.tag) || m.tag === "a";
  const hasInnerButton = (n) => desc(n, (c) => c.kind !== "text" && isBtnTag(c) && (c.props.onClick !== undefined || c.props.type === "submit")).length > 0;

  for (const n of nodes) {
    if (n.kind === "text" || n.id === "root") continue;
    const t = n.tag;
    const handlers = Object.keys(n.props).filter((k) => /^on[A-Z]/.test(k));
    if (n.props.href !== undefined) handlers.push("href");
    if (n.props.type === "submit") handlers.push("type=submit");
    if (TABLE.test(t)) n.kind = "table";
    else if (ROW.test(t)) n.kind = "row";
    else if (CELL.test(t)) n.kind = "cell";
    else if (INPUT.test(t)) n.kind = "input";
    const clickableRow = !isBtnTag(n) && hasFlag(n, "clickable") && !hasInnerButton(n);
    if (t === "form" || BUTTON.test(t) || (t === "a" && (n.props.href !== undefined || handlers.length)) || handlers.some((h) => /^on(Click|Submit|KeyDown|MouseDown)$/.test(h)) || prop(n, "role") === "button" || NAV_ITEM.test(t) || clickableRow) n.kind = "interaction";
    else if (VISUAL.test(t)) n.kind = "visual";
    else if (MEDIA.test(t) || ICON.test(t)) n.kind = "media";
    if (n.kind === "interaction") {
      // A clickable row/card has no own text label worth reading (labelOf would grab every descendant's text);
      // "open" is the fixed verb suggest-markers.mjs gives this idiom, so the label agrees with it via verbOf.
      const label = clickableRow ? "Open (clickable row)" : labelOf(n);
      n.details = {
        tag: t, label, handlers, verb: verbOf(label), ...(t === "form" ? { form: true } : {}), ...(NAV_ITEM.test(t) ? { navigation: true } : {}), ...(prop(n, "href") ? { href: prop(n, "href") } : {}),
        // A clickable Table.Row/tr is still a table row structurally (grouping, columns, index) even though it is
        // now classified `interaction` so the actions pipeline sees it; carry the same "header" flag a `row` node gets.
        ...(ROW.test(t) ? { header: HEADER_ROW.test(t) || desc(n, (c) => c.kind !== "text" && HEADER_CELL.test(c.tag)).length > 0 } : {}),
      };
    } else if (n.kind === "input") {
      const sub = desc(n, (c) => c.kind !== "text" && /\.Input$/.test(c.tag))[0];
      const inputType = prop(n, "type") ?? (t === "select" || t === "Select" ? "select" : t === "textarea" || /^Text[Aa]rea$/.test(t) ? "textarea" : /^(Checkbox|Switch|Radio\w*|Slider)$/.test(t) ? t.toLowerCase() : "text");
      const par = byId.get(n.parent);
      const wrapLabel = par && par.tag === "label" ? textIn(par) : "";
      n.details = {
        tag: t, inputType, name: prop(n, "name"),
        label: prop(n, "label") ?? prop(n, "aria-label") ?? (collapseWs(wrapLabel) || null),
        placeholder: prop(n, "placeholder") ?? (sub ? prop(sub, "placeholder") : null),
        options: desc(n, (c) => c.kind !== "text" && OPTION.test(c.tag)).map((o) => textIn(o) || prop(o, "value") || "").filter(Boolean),
        required: hasFlag(n, "required"), disabled: hasFlag(n, "disabled"),
        defaultValue: prop(n, "defaultValue") ?? prop(n, "value") ?? (hasFlag(n, "defaultChecked") ? "checked" : null),
      };
    } else if (n.kind === "media" || n.kind === "visual") {
      n.details = { media: t, subtype: ICON.test(t) ? "icon" : n.kind === "visual" ? "graphic" : "image", alt: prop(n, "alt"), ariaLabel: prop(n, "aria-label"), title: prop(n, "title") };
    } else if (n.kind === "row") n.details = { header: HEADER_ROW.test(t) || desc(n, (c) => c.kind !== "text" && HEADER_CELL.test(c.tag)).length > 0 };
    else if (n.kind === "cell") n.details = { header: HEADER_CELL.test(t) };
  }

  // ---- 4. lists, tables: repeated runs (see collapse.mjs), columns, template row ----
  // A clickable Table.Row/tr is `interaction` kind (so the actions pipeline sees it) but is still structurally a
  // table row: grouping, columns and index tracking below key off the tag (ROW, via isRowNode), not just the `row` kind.
  const groups = [];
  const minFor = (el) => (el.kind === "cell" || isRowNode(el) ? Infinity : 3); // cells of one row are columns, not repetition; rows are grouped below
  for (const p of nodes) {
    if (p.kind === "text") continue;
    // Table rows: ALL data rows of a parent are one group, whatever their shape (a table's rows differ in badges and cells)
    const dataRows = p.children.map((id) => byId.get(id)).filter((c) => isRowNode(c) && !c.details.header);
    if (dataRows.length >= 2) groups.push({ id: "g" + sha1(dataRows[0].id).slice(0, 8), parent: p.id, shape: dataRows[0].shape, members: dataRows.map((m) => m.id), mapped: false, loose: new Set(dataRows.map((m) => m.shape)).size > 1 });
    for (const run of repeatRuns(byId, p, memo, minFor)) groups.push({ id: "g" + sha1(run.members[0].id).slice(0, 8), parent: p.id, shape: shapeHash(run.shape), members: run.members.map((m) => m.id), mapped: false, loose: false });
    // a `.map()` renders one instance in the source: it is a run of one, the count is unknown
    const mapped = p.children.map((id) => byId.get(id)).filter((c) => c.kind !== "text" && c.via?.map && !groups.some((g) => g.members.includes(c.id)));
    for (const m of mapped) groups.push({ id: "g" + sha1(m.id).slice(0, 8), parent: p.id, shape: m.shape, members: [m.id], mapped: true, loose: false });
  }
  const groupOfMember = new Map();
  for (const g of groups) for (const m of g.members) groupOfMember.set(m, g);
  for (const g of groups) {
    const p = byId.get(g.parent);
    for (const m of g.members) { const mn = byId.get(m); if (mn.kind === "container") mn.kind = "row"; if (mn.kind === "row" || mn.kind === "interaction") mn.details = { ...mn.details, group: g.id }; }
    if (p.kind === "container" || p.kind === "list") p.kind = "list";
  }
  // a Table whose rows are not a run (fewer than 2 data rows) still gets its columns
  for (const p of nodes) {
    if (p.kind !== "table" && !(p.kind === "list") && p.props?.["data-list"] === undefined) continue;
    const headerCells = desc(p, (c) => c.kind === "cell" && c.details.header);
    const dataRows = desc(p, (c) => isRowNode(c) && !c.details.header); // the table's own rows, not a chip row inside a cell
    const headerTexts = headerCells.map((c) => collapseWs(textInNode(byId, c)));
    const cellsOf = (r) => r.children.map((id) => byId.get(id)).filter((c) => c.kind === "cell");
    const width = Math.max(headerTexts.length, ...dataRows.map((r) => cellsOf(r).length), 0);
    // tracked by position: a row's index in the table, a cell's column index in its row
    dataRows.forEach((r, ri) => { r.details = { ...r.details, index: ri }; cellsOf(r).forEach((c, ci) => { c.details = { ...c.details, row: ri, col: ci }; }); });
    p.details = {
      ...p.details, tag: p.tag, mapped: p.children.some((id) => byId.get(id).via?.map),
      templateRow: dataRows[0]?.id ?? groups.find((g) => g.parent === p.id)?.members[0] ?? null,
      rowCount: dataRows.length || (groups.find((g) => g.parent === p.id)?.members.length ?? 0),
      rows: dataRows.map((r) => r.id),
      columns: Array.from({ length: p.kind === "table" ? width : 0 }, (_, i) => ({ index: i, header: headerTexts[i] ?? "", examples: dataRows.slice(0, 3).map((r) => collapseWs(textInNode(byId, cellsOf(r)[i] ?? null))).filter(Boolean) })),
    };
  }
  // charts and graphics: the labels inside them (series, axis, legend text) and on them, to be mapped to data items
  for (const n of nodes) {
    if (n.kind !== "visual" && n.kind !== "media") continue;
    const texts = [];
    const walk = (id) => { const c = byId.get(id); if (c.kind === "text") { if (c.textKind !== "expression") texts.push(c.text); } else c.children.forEach(walk); };
    n.children.forEach(walk);
    for (const k of ["alt", "aria-label", "title"]) if (typeof n.props[k] === "string") texts.push(n.props[k]);
    n.details = { ...n.details, labels: [...new Set(texts.filter(Boolean))], chart: n.kind === "visual" && n.details.subtype === "graphic" };
  }
  // an existing marker also makes a list of its element
  for (const n of nodes) if (n.kind === "container" && n.props?.["data-list"] !== undefined) n.kind = "list";

  const counts = {};
  for (const n of nodes) if (n.id !== "root") counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  const states = detectStates({ nodes, byId }, source, file);
  return { file, nodes, byId, root: root.id, counts, groups, states };
}

function literalAttr(src, name) {
  const m = src.match(new RegExp(`^${name.replace(/[-]/g, "\\-")}=\\{\\s*(["'\`])((?:(?!\\1)[\\s\\S])*)\\1\\s*\\}$`));
  return m ? { text: m[2], textKind: "attribute" } : null;
}

/** The visible text of a node record: its own and its descendants' text nodes (not attribute text), collapsed. */
export function textInNode(byId, node) {
  if (!node) return "";
  if (node.kind === "text") return node.textKind === "attribute" ? "" : node.text;
  return collapseWs(shapeKids(byId, node).map((c) => textInNode(byId, c)).join(" "));
}

/** Every node record under `id` (not itself), document order. */
export function descendants(inv, id) {
  const out = [];
  const go = (n) => { for (const c of n.children) { const cn = inv.byId.get(c); out.push(cn); go(cn); } };
  go(inv.byId.get(id));
  return out;
}

/** The nearest ancestor (or the node itself when `self`) that satisfies `pred`. */
export function ancestor(inv, node, pred, self = false) {
  for (let n = self ? node : inv.byId.get(node.parent); n; n = n.parent ? inv.byId.get(n.parent) : null) if (pred(n)) return n;
  return null;
}

/** A table row: `row` kind, or a clickable Table.Row/tr — `interaction` kind so the actions pipeline sees it, but
 * still a row structurally (grouping, columns, "the label of a control" heuristics all key off this, not just `row`). */
export const isRowNode = (n) => ROW.test(n.tag) && (n.kind === "row" || n.kind === "interaction");
