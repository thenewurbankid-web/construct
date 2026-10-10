// From decisions to a marked copy of the page. Pure and deterministic: same source + same decisions = the same bytes.
//
// Every change is an exact-offset splice of the original text (Construct's `spliceNode`, through the import block's
// seam), exactly as src/import/apply-markers.mjs does it: formatting, comments and everything outside the touched tags
// stay byte-identical, a new attribute follows the tag's own layout, an element that already has the attribute is left
// alone (so applying twice changes nothing), and the result is re-parsed to be sure it is still valid JSX/TSX. For the
// edits the import block's rules would make, the output equals `applyMarkers(source, ids)` byte for byte (a test pins it).
//
// Only ACCEPTED decisions write anything: a proposal nobody looked at changes nothing. Static copy, visuals and
// structure need no marker; the extractor finds visuals by tag.
import { spliceNode, renderAttrValue } from "../import/construct-ast.mjs";
import { attrInsertion } from "../import/apply-markers.mjs";
import { parsePage } from "../import/parse.mjs";
import { effectiveOf, rootOf } from "./classify.mjs";
import { camel } from "./inventory.mjs";
import { diffFile } from "../diff.mjs";

const descendantsHaveText = (byId, n) => n.children.some((id) => { const c = byId.get(id); return c.kind === "text" ? c.textKind !== "attribute" : descendantsHaveText(byId, c); });
const LOWER_FIELD = /^(input|select|textarea)$/;
const NAME_OK = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

// The layout-aware attribute insertion is the import block's own (`attrInsertion` in apply-markers.mjs, exported for this use; adding the
// `export` changes nothing there). It reads an element's start, tag and attribute offsets, which an inventory node keeps in `spans`.
const insertion = (source, node, attrs) => attrInsertion(source, { start: node.start, tag: node.tag, attrs: node.spans.attrs }, attrs);

/**
 * The state every node ends up in, given the decisions.
 *
 * @param {object} ctx `{inv, follow, proposals}` from the page service.
 * @param {Object<string,object>} decisions Decisions by (template) node id.
 * @returns {Object<string,{cls:string,strength:string,status:string,name:string|null}>} `effectiveOf` for every node.
 */
export function effectiveAll({ inv, follow, proposals }, decisions) {
  const out = {};
  for (const n of inv.nodes) {
    if (n.id === "root") continue;
    const p = proposals[n.id];
    // a row or a table wrapper has no marker of its own: it follows the decision on the element that carries data-list
    out[n.id] = effectiveOf(n, p, decisions[rootOf(follow, n.id)] ?? decisions[n.id] ?? (p.delegate ? decisions[p.delegate] : undefined));
  }
  return out;
}

/**
 * The source edits the decisions call for, before names are made unique.
 *
 * @param {object} ctx `{inv, cx, proposals, source}`.
 * @param {Object<string,object>} decisions Decisions by node id.
 * @param {Object<string,object>} [eff] `effectiveAll` result (computed when omitted).
 * @returns {{kind:"attr"|"wrap", target?:string, start?:number, end?:number, attr:string, value:string, node:string, root:string, note?:string}[]}
 *   Attribute edits (`target` = element node id) and span wraps (offsets). `note` explains a decision that cannot be written.
 */
export function editsFor(ctx, decisions, eff = effectiveAll(ctx, decisions)) {
  const { inv, follow, proposals } = ctx;
  const { byId } = inv;
  const edits = [];
  const ownTexts = (el) => el.children.map((id) => byId.get(id)).filter((c) => c.kind === "text" && c.textKind !== "attribute");
  for (const n of inv.nodes) {
    if (n.id === "root") continue;
    const root = rootOf(follow, n.id);
    const d = decisions[root] ?? decisions[n.id] ?? (proposals[n.id].delegate ? decisions[proposals[n.id].delegate] : undefined);
    if (!d || d.act === "reject") continue;
    const e = eff[n.id], p = proposals[n.id];
    if (p.existing && e.cls === p.cls) continue; // the page already has it
    const name = e.name && NAME_OK.test(e.name) ? e.name : null;
    const rec = (x) => edits.push({ node: n.id, root, ...x });
    if (e.cls === "dynamic" && n.kind === "text") {
      if (n.textKind === "attribute" || n.textKind === "expression") { rec({ kind: "none", attr: "data-dyn", value: name ?? "value", note: n.textKind === "attribute" ? "attribute text cannot carry data-dyn" : "already an expression" }); continue; }
      const useTokens = d.act === "accept" && p.tokens && p.cls === "dynamic";
      if (useTokens) for (const t of p.tokens) rec({ kind: "wrap", start: t.start, end: t.end, attr: "data-dyn", value: t.name, tokenId: t.ruleId });
      else {
        const el = byId.get(n.parent);
        // the whole element carries the marker when the import rule said so (`whole`) or when this text is all of the element's text;
        // if a child element holds other text (`<p>orders <b>3</b></p>`), only this text is wrapped, or the two markers would nest
        const otherText = el && el.kind !== "text" && el.children.some((id) => { const c = byId.get(id); return c.kind !== "text" && descendantsHaveText(byId, c); });
        if (el && el.kind !== "text" && ownTexts(el).length === 1 && el.id !== "root" && ((d.act === "accept" && proposals[n.id].whole === el.id) || !otherText)) rec({ kind: "attr", target: el.id, attr: "data-dyn", value: name ?? (camel(n.text, 3) || "value") });
        else rec({ kind: "wrap", start: n.start, end: n.end, attr: "data-dyn", value: name ?? (camel(n.text, 3) || "value") });
      }
    } else if (e.cls === "list" && n.kind !== "text") {
      const target = byId.get(p.delegate ?? n.id);
      if (!target) rec({ kind: "attr", target: p.delegate, attr: "data-list", value: name ?? "items" }); // caught below as an orphan
      else if (target.kind === "list" || target.kind === "table" || target.kind === "container") rec({ kind: "attr", target: target.id, attr: "data-list", value: name ?? proposals[target.id]?.name ?? "items" });
    } else if (e.cls === "action" && n.kind === "interaction") {
      rec({ kind: "attr", target: n.id, attr: "data-action", value: name ?? n.details.verb });
    } else if (e.cls === "input" && n.kind === "input") {
      if (LOWER_FIELD.test(n.tag) && typeof n.props.name !== "string") rec({ kind: "attr", target: n.id, attr: "name", value: name ?? (camel(n.details.label ?? n.details.placeholder ?? "", 3) || "field") });
      else if (typeof n.props.name !== "string") rec({ kind: "none", attr: "name", value: "", note: "a component field: the extractor only reads the names of lowercase input/select/textarea" });
    } else if (e.cls === "action" && n.kind === "container" && n.tag === "form") rec({ kind: "attr", target: n.id, attr: "data-action", value: name ?? "submit" });
  }
  // An edit whose target is not in the inventory (or whose text range is not in the source) can never be written: it becomes an
  // "orphan" note, recorded and skipped, and nothing downstream (summary, diff, apply) can throw on it.
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const bad = e.kind === "attr" ? !byId.has(e.target) : e.kind === "wrap" ? !(Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end > e.start && e.end <= (ctx.source?.length ?? Infinity)) : false;
    if (bad) edits[i] = { kind: "none", orphan: true, attr: e.attr, value: e.value ?? "", node: e.node, root: e.root, note: "orphan: the element this edit points at is not on the page any more" };
  }
  // A data-dyn on an element that holds another marked value (an accepted or existing data-dyn inside it) would nest two
  // markers, and the extractor would read the outer one as the whole text. Wrap this node's own text instead.
  const isIn = (x, el) => (x.kind === "wrap" ? x.start >= el.start && x.end <= el.end : x.kind === "attr" && x.target !== el.id && byId.get(x.target).start >= el.start && byId.get(x.target).end <= el.end);
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.kind !== "attr" || e.attr !== "data-dyn") continue;
    const el = byId.get(e.target);
    const nested = edits.some((x) => x !== e && x.attr === "data-dyn" && isIn(x, el)) || inv.nodes.some((d) => d.kind !== "text" && d.props?.["data-dyn"] !== undefined && d.id !== el.id && d.start >= el.start && d.end <= el.end);
    if (nested) { const t = byId.get(e.node); edits[i] = { kind: "wrap", start: t.start, end: t.end, attr: "data-dyn", value: e.value, node: e.node, root: e.root }; }
  }
  // several nodes can point at one element (a table wrapper, its rows): write each attribute once
  const seen = new Set();
  return edits.filter((e) => { const k = e.kind === "wrap" ? `w:${e.start}:${e.end}` : e.kind === "attr" ? `a:${e.target}:${e.attr}` : null; if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Names a person changed can collide; the marker values must stay unique per scope (data-dyn per list or page, data-list per page).
function uniqueNames(ctx, edits) {
  const { inv, proposals } = ctx;
  const taken = { "data-dyn": new Map(), "data-list": new Map() }; // attr -> scope -> Set(names)
  const finalName = new Map();
  // the scope of a data-dyn name: the outermost strong list the node sits in (its row fields), else the page
  const scopeOf = (id) => {
    let scope = "page";
    for (let n = inv.byId.get(id); n; n = n.parent ? inv.byId.get(n.parent) : null) if (n.kind === "row" && n.details.group && proposals[n.id]?.cls === "list") scope = n.details.group;
    return scope;
  };
  const order = edits.filter((e) => taken[e.attr]).sort((a, b) => inv.byId.get(a.node).start - inv.byId.get(b.node).start);
  for (const e of order) {
    const scope = e.attr === "data-list" ? "page" : scopeOf(e.node);
    const key = `${e.attr}|${scope}|${e.root}|${e.value}`;
    if (!finalName.has(key)) {
      const reg = taken[e.attr].get(scope) ?? new Set();
      let n = e.value, i = 1;
      while (reg.has(n)) n = `${e.value}${++i}`;
      reg.add(n);
      taken[e.attr].set(scope, reg);
      finalName.set(key, n);
    }
    e.value = finalName.get(key);
  }
  return edits;
}

// Write the edits into the source (right to left, so earlier offsets stay valid).
function applyEdits({ source, inv }, edits) {
  const perEl = new Map(), splices = [], seenWrap = new Set();
  for (const e of edits) {
    if (e.kind === "wrap") {
      const key = `${e.start}:${e.end}`;
      if (seenWrap.has(key)) continue;
      seenWrap.add(key);
      splices.push({ start: e.start, end: e.end, text: `<span ${e.attr}${renderAttrValue("string", e.value)}>${source.slice(e.start, e.end)}</span>` });
    } else if (e.kind === "attr") {
      const el = inv.byId.get(e.target);
      if (el.spans.attrs.some((a) => a.name === e.attr)) continue; // already there: leave it alone
      const list = perEl.get(el) ?? [];
      if (!list.some(([n]) => n === e.attr)) perEl.set(el, [...list, [e.attr, e.value]]);
    }
  }
  for (const [el, attrs] of perEl) splices.push(insertion(source, el, attrs));
  splices.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const s of splices) out = spliceNode(out, s, s.text);
  return out;
}

/**
 * The marked copy of the page.
 *
 * @param {object} ctx `{inv, cx, proposals, source}` from the page service.
 * @param {Object<string,object>} decisions Decisions by node id.
 * @returns {{source:string, edits:object[], skipped:object[]}} The new source; the edits written; the decisions that cannot be written and why.
 * @throws {Error} When the result would not parse (never expected: each edit is a plain text splice).
 */
export function applyDecisions(ctx, decisions) {
  const all = uniqueNames(ctx, editsFor(ctx, decisions));
  const out = applyEdits(ctx, all.filter((e) => e.kind !== "none"));
  parsePage(out); // throws if an edit broke the syntax
  return { source: out, edits: all.filter((e) => e.kind !== "none"), skipped: all.filter((e) => e.kind === "none") };
}

/**
 * The diff of what accepting ONE node (with its class and name as they stand) would change, as Trace's line diff.
 *
 * @param {object} ctx `{inv, cx, proposals, source}`.
 * @param {string} id Node id.
 * @param {{cls:string,name?:string|null}} as The class and name to write.
 * @returns {{status:string, added:number, removed:number, hunks:object[]}|null} `null` when the class writes nothing (static, visual, structure, unsure).
 */
export function diffOf(ctx, id, as) {
  const root = rootOf(ctx.follow, id);
  const p = ctx.proposals[id];
  const act = as.cls === (p.cls === "unsure" ? p.lean : p.cls) ? "accept" : "change"; // "accept" keeps the import block's own edit (sentence tokens)
  const single = { [root]: { act, cls: as.cls, ...(as.name ? { name: as.name } : {}) } };
  const mine = editsFor(ctx, single).filter((e) => e.node === id);
  if (!mine.length || mine.every((e) => e.kind === "none")) return null;
  return diffFile(ctx.source, applyEdits(ctx, mine));
}

/**
 * One line saying what accepting a node's proposal would write (for the violation list and the review pack).
 *
 * @param {object} ctx `{inv, follow, proposals, source}`.
 * @param {string} id Node id.
 * @returns {string} e.g. "add `data-dyn="total"` to `<span>` (line 12)", or "none ..." when nothing would be written.
 */
export function editSummary(ctx, id) {
  const { inv, source, proposals } = ctx;
  const p = proposals[id];
  const cls = p.cls === "unsure" ? p.lean : p.cls;
  const all = editsFor(ctx, { [id]: { act: "accept", by: "rule" } }).filter((x) => x.node === id);
  const es = all.filter((x) => x.kind === "wrap" || x.kind === "attr");
  if (!es.length) { const n = all.find((x) => x.note); return n ? `${n.orphan ? "" : "none: "}${n.note}` : "none (already marked, or nothing to write)"; }
  const lineOf = (off) => source.slice(0, off).split("\n").length;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  return es.map((x) => (x.kind === "wrap" ? `wrap \`${clip(source.slice(x.start, x.end), 30)}\` in \`<span ${x.attr}="${x.value}">\` (line ${lineOf(x.start)})` : `add \`${x.attr}="${x.value}"\` to \`<${inv.byId.get(x.target).tag}>\` (line ${inv.byId.get(x.target).line})`)).join("; ") + (cls === p.cls ? "" : ` (leans ${cls})`);
}
