// Classification with suggested edits for the Page map. Pure and deterministic: rules only, no model, no I/O.
//
// Every node of the inventory gets exactly one PROPOSAL: a class, a strength (strong | weak), the reasons, and the
// false-positive risk. A proposal is a SUGGESTED EDIT the user reviews (accept / reject / change class); nothing is written
// by this module. Classes:
//   dynamic   the text is data from the API           static    fixed wording (needs no marker)
//   list      a list/table or one of its rows          action    a control that should call the API
//   input     a field the user fills in                visual    a chart, image or icon (its data is supplied elsewhere)
//   structure layout only, nothing to decide           unsure    the rules disagree or only weak evidence exists (`lean` says which way)
//
// The rules are the import block's suggestMarkers rules (numbers, money, dates, percents, deltas, "N of M", repeated rows,
// verbs on buttons, form inputs; run through planMarkers so they stay ONE implementation) PLUS:
//   - a text that equals an API example value of the contract is a strong hint (weak when it is a short bare number or only
//     an aggregate, which match by coincidence); a sentence that mentions an API value is unsure
//   - table header text maps to its column; text inside a list row template is dynamic unless identical in every row
//   - a stat card's label (label + big number pair) is static; text inside a control is its label; attribute text is static
//   - an existing data-dyn / data-list / data-action / name is shown as accepted
import { planMarkers } from "../import/suggest-markers.mjs";
import { camel, collapseWs, textInNode, ancestor, descendants, isRowNode } from "./inventory.mjs";

/** Class keys and the words the page uses for them. */
export const CLASS_LABELS = { dynamic: "dynamic value", static: "static copy", list: "list row template", action: "action", input: "input", visual: "visual", structure: "structure", unsure: "unsure" };
export const CLASS_KEYS = Object.keys(CLASS_LABELS);

// Kept in step with suggest-markers.mjs (its NAV_TAG is not exported); a test asserts the two agree on the real pages.
const NAV = /(^|\.)(nav|aside)$|SideNav|Sidebar|Breadcrumbs?|^Tabs?(\.|$)|^TopbarWithRightNav|NavItem|Menu/;
const NUMBERISH = /^[▲▼+\-−]?\s?[$€£]?\d/;
const RISKY = /navigation|button|skeleton/i;
// numbers inside a sentence (as suggest-markers' RE_TOKEN, without "N of M"): candidates for a token-level marker
const RE_NUM_TOKEN = /(?<![\w.$€£#&])[$€£]?\d[\d,.]*[KMB%]?(?![\w])/g;

const words = (s) => collapseWs(s).split(" ").filter(Boolean);

/**
 * @typedef {object} Proposal
 * @property {string} id
 * @property {"dynamic"|"static"|"list"|"action"|"input"|"visual"|"structure"|"unsure"} cls
 * @property {"strong"|"weak"} strength
 * @property {string[]} reasons
 * @property {string|null} risk           why it may be a false positive
 * @property {boolean} existing           the page already carries the marker (shown as accepted)
 * @property {string} [name]              the marker value that would be written (`totalSpend`, `categories`, `save`)
 * @property {string} [ruleId]            the suggestMarkers id this came from (`dyn-12:9`), when a rule of the import block fired
 * @property {"dynamic"} [lean]           for `unsure`: the class it leans towards
 * @property {{start:number,end:number,name:string}[]} [tokens]  numbers inside a sentence that would be wrapped in a span
 * @property {boolean} [partial]         only the tokens are data, not the whole text
 * @property {string} [whole]             id of the element that would carry data-dyn (the text is all of its own text)
 * @property {string} [column]            the table column header the text sits under
 * @property {{field:string, formatter:string, source:string}[]} [contract]  the API values the text equals
 * @property {string[]} [mentions]        API values a sentence contains
 * @property {string} [group]             repeated group this node belongs to
 * @property {string} [delegate]          for a table/list wrapper or a row: the id of the element that would carry data-list
 */

/**
 * Classify every node of an inventory.
 *
 * @param {ReturnType<typeof import("./inventory.mjs").buildInventory>} inv The inventory of `source`.
 * @param {ReturnType<typeof import("./collapse.mjs").collapse>} cx Its collapse result.
 * @param {string} source The same source text the inventory was built from.
 * @param {{contract?: ReturnType<typeof import("./contract-match.mjs").contractMatcher>}} [opts] The example's contract matcher, when there is one.
 * @returns {{proposals: Object<string, Proposal>, issues: Object<string,"ambiguous"|"unclassified">, follow: Object<string,string>}}
 *   A proposal for every node except the virtual root; `issues` lists the nodes the issue registry names (ambiguous / unclassified);
 *   `follow` maps an instance node in the rows of a strong list to its counterpart in the template row (a decision on the template covers it).
 */
export function classify(inv, cx, source, { contract = null } = {}) {
  const { byId } = inv;
  const plan = planMarkers(source);
  const nodes = inv.nodes.filter((n) => n.id !== "root");
  const elAt = new Map(nodes.filter((n) => n.kind !== "text").map((n) => [`${n.line}:${n.col}`, n]));
  const textNodes = nodes.filter((n) => n.kind === "text" && n.textKind !== "attribute");
  const findText = (offset) => textNodes.find((t) => t.start <= offset && offset < t.end);
  const ownTexts = (el) => el.children.map((id) => byId.get(id)).filter((c) => c.kind === "text" && c.textKind !== "attribute");

  // ---- rule hits from the import block, mapped onto nodes ----
  const ruleText = new Map(), ruleNode = new Map();
  for (const { suggestion: s, edit: e } of plan) {
    if (s.kind === "dyn") {
      if (e.wrap) {
        const t = findText(e.wrap.start);
        if (t) { const h = ruleText.get(t.id) ?? { sug: s, tokens: [] }; h.tokens.push({ start: e.wrap.start, end: e.wrap.end, name: s.name, ruleId: s.id }); ruleText.set(t.id, h); }
      } else {
        const el = elAt.get(`${s.loc.line}:${s.loc.column}`);
        // (a whole-element hit on an element that already holds marked parts is an artefact of a half-marked page)
        if (el && !descendants(inv, el.id).some((d) => d.props?.["data-dyn"] !== undefined)) for (const t of ownTexts(el)) if (!ruleText.has(t.id)) ruleText.set(t.id, { sug: s, whole: el.id });
      }
    } else {
      const el = elAt.get(`${s.loc.line}:${s.loc.column}`);
      if (el && !ruleNode.has(el.id)) ruleNode.set(el.id, s);
    }
  }
  // ---- existing markers ----
  const existingText = new Map(), existingNode = new Map();
  for (const n of nodes) {
    if (n.kind === "text") continue;
    const dyn = n.props["data-dyn"], list = n.props["data-list"], act = n.props["data-action"];
    if (typeof dyn === "string") for (const t of descendants(inv, n.id)) if (t.kind === "text" && t.textKind !== "attribute") existingText.set(t.id, dyn);
    if (typeof list === "string") existingNode.set(n.id, { cls: "list", name: list, attr: "data-list" });
    if (typeof act === "string") existingNode.set(n.id, { cls: "action", name: act, attr: "data-action" });
    if (n.kind === "input" && typeof n.props.name === "string") existingNode.set(n.id, { cls: "input", name: n.props.name, attr: "name" });
  }

  const P = {};
  const put = (n, cls, strength, reasons, extra = {}) => { P[n.id] = { id: n.id, cls, strength, reasons, risk: null, existing: false, ...extra }; return P[n.id]; };

  // ---- non-text nodes ----
  const listGroups = new Map(); // parent id -> group
  const groupOfRow = new Map();
  for (const g of cx.groups) { listGroups.set(g.parent, g); for (const m of g.members) groupOfRow.set(m, g); }
  for (const n of nodes) {
    if (n.kind === "text") continue;
    const rule = ruleNode.get(n.id), ex = existingNode.get(n.id);
    if (ex && ex.cls === "list" && (n.kind === "list" || n.kind === "table" || n.kind === "container")) { put(n, "list", "strong", [`the page marks this as a list (${ex.attr}="${ex.name}")`], { existing: true, name: ex.name }); continue; }
    if (n.kind === "interaction") {
      const nav = n.details.navigation || !!ancestor(inv, n, (a) => NAV.test(a.tag), true);
      if (ex) put(n, "action", "strong", [`the page marks this as an action (${ex.attr}="${ex.name}")`], { existing: true, name: ex.name });
      else if (rule && (rule.kind === "action" || rule.kind === "form")) put(n, "action", rule.strength, [rule.reason], { risk: rule.risk, name: rule.name, ruleId: rule.id });
      else put(n, "action", "weak", [n.details.handlers.length ? `${n.tag} with ${n.details.handlers.join(", ")}` : `${n.tag} with no handler in the design`], {
        risk: nav ? "navigation: sidebar, breadcrumbs and menu items are usually static" : n.details.handlers.length ? "cancel/close and toggle controls are UI-only" : "no onClick in the design, so nothing is attached to an API action yet", name: n.details.verb });
    } else if (n.kind === "input") {
      if (ex) put(n, "input", "strong", [`the page names this field (name="${ex.name}")`], { existing: true, name: ex.name });
      else if (rule) put(n, "input", rule.strength, [rule.reason], { risk: rule.risk, name: rule.name, ruleId: rule.id });
      else put(n, "input", "weak", [`${n.tag} field`], { risk: "no rule wrote a name for it", name: camel(n.details.label ?? n.details.placeholder ?? "", 3) || "field" });
    } else if (n.kind === "visual" || n.kind === "media") {
      put(n, "visual", "strong", [n.details.subtype === "icon" ? "an icon: decorative, nothing to fetch" : `a ${n.details.media}: its data or picture is supplied outside the markup`]);
    } else if (n.kind === "list" || n.kind === "table") {
      // decided in the second pass, once the rows know their list
    } else if (n.kind === "row") {
      // decided in the second pass
    } else put(n, "structure", "strong", ["layout only"]);
  }
  // lists (a rule fired on the parent of the rows)
  for (const n of nodes) {
    if (n.kind !== "list" && n.kind !== "table" && n.kind !== "row") continue;
    if (P[n.id]) continue;
    const rule = ruleNode.get(n.id);
    if (rule && rule.kind === "list") put(n, "list", rule.strength, [rule.reason], { risk: rule.risk, name: rule.name, ruleId: rule.id });
  }
  for (const n of nodes) {
    if (P[n.id] || (n.kind !== "list" && n.kind !== "table")) continue;
    // a table or list wrapper with no rule of its own: it is a list when the rows below it are
    const inner = descendants(inv, n.id).find((d) => P[d.id]?.cls === "list" && d.kind !== "row");
    if (inner) put(n, "list", P[inner.id].strength, [`its rows are a list (${P[inner.id].reasons[0]})`], { risk: P[inner.id].risk, name: P[inner.id].name, delegate: inner.id });
    else put(n, "structure", "strong", [n.kind === "table" ? "a table with too few rows to call a list" : "repeated structure, but no list rule fired"]);
  }
  for (const n of nodes) {
    if (n.kind !== "row" || P[n.id]) continue;
    const g = groupOfRow.get(n.id);
    const parentP = g && P[g.parent];
    if (n.details.header) put(n, "structure", "strong", ["the header row"]);
    else if (parentP && parentP.cls === "list") put(n, "list", parentP.strength, [g.members[0] === n.id ? "the template row: the first row is the template" : `row of a list of ${g.members.length}`], { risk: parentP.risk, name: parentP.name, group: g.id, delegate: g.parent });
    else put(n, "structure", "strong", ["a row outside a list"]);
  }

  // A decision on the template covers its instances only for the rows of a real (strong) list; the values in a stat strip, a row
  // of chips or a legend are independent, so each is decided on its own.
  const follow = {};
  for (const g of cx.groups) { const lp = P[g.parent]; if (lp && lp.cls === "list" && lp.strength === "strong" && !g.mapped && g.count > 1) Object.assign(follow, g.links); }

  // ---- text nodes ----
  const slotByNode = new Map(); // node id -> slots (of every group it sits in) that hold text
  // Only the rows of a strong list count: repeated structure elsewhere says nothing about its texts.
  for (const g of cx.groups) {
    const lp = P[g.parent];
    if (!lp || lp.cls !== "list" || lp.strength !== "strong" || g.count === 1 || g.mapped) continue; // a weak list is a stat strip, chips or a legend: its texts are not row fields
    for (const s of g.slots) if (s.type === "text") for (const id of s.nodeIds) if (id) (slotByNode.get(id) ?? slotByNode.set(id, []).get(id)).push({ ...s, group: g, listStrength: lp.strength });
  }
  const labelBefore = (n) => {
    const i = textNodes.indexOf(n);
    for (const t of textNodes.slice(Math.max(0, i - 8), i).reverse()) {
      if (t.text.length < 3 || t.text.length > 50 || /\d/.test(t.text) || /[.!?]( |$)/.test(t.text) || !/[A-Za-z]{3}/.test(t.text) || NUMBERISH.test(t.text)) continue;
      return camel(t.text);
    }
    return "";
  };
  const columnOf = (n) => {
    const cell = ancestor(inv, n, (a) => a.kind === "cell" && !a.details.header);
    const row = cell && ancestor(inv, cell, isRowNode);
    const table = row && ancestor(inv, row, (a) => a.kind === "table");
    if (!table) return null;
    const idx = row.children.map((id) => byId.get(id)).filter((c) => c.kind === "cell").indexOf(cell);
    const header = table.details.columns?.[idx]?.header;
    return header ? { header, index: idx } : { header: "", index: idx };
  };
  const statLabel = (n) => {
    const el = byId.get(n.parent);
    if (!el || el.kind === "text" || ownTexts(el).length !== 1 || words(n.text).length > 6 || /\d/.test(n.text)) return null;
    const par = byId.get(el.parent);
    if (!par) return null;
    const sibs = par.children.map((id) => byId.get(id)).filter((c) => c.kind !== "text");
    const next = sibs[sibs.indexOf(el) + 1];
    const first = next && descendants(inv, next.id).concat(next).find((d) => d.kind === "text" && d.textKind !== "attribute");
    return first && NUMBERISH.test(first.text) ? first.text : null;
  };
  const unitSuffix = (n) => {
    if (!/^([KMB%]|days?|d|pts?)$/i.test(n.text)) return false;
    const i = textNodes.indexOf(n);
    const prev = textNodes[i - 1];
    const gp = (id) => byId.get(byId.get(id)?.parent)?.parent ?? null;
    return !!prev && NUMBERISH.test(prev.text) && (prev.parent === n.parent || gp(prev.id) === gp(n.id));
  };
  const nameFor = (n, rule) => {
    if (rule?.sug) return rule.sug.name;
    const col = columnOf(n);
    if (col && slotByNode.has(n.id)) return camel(col.header) || `col${col.index + 1}`;
    return labelBefore(n) || "value";
  };
  const textOfPropose = (n) => {
    const t = n.text;
    const rule = ruleText.get(n.id);
    const ex = existingText.get(n.id);
    const slots = slotByNode.get(n.id) ?? [];
    const col = columnOf(n);
    const extra = { ...(col?.header ? { column: col.header } : {}), ...(slots[0] ? { group: slots[0].group.id } : {}) };
    // a clickable Table.Row/tr is `interaction` kind too, but it wraps a whole row of independent data cells, not
    // one control's own label (row/column data still becomes dynamic below, per the row's slots)
    const inCtl = ancestor(inv, n, (a) => a.kind === "interaction" && !isRowNode(a));
    const inNav = !!ancestor(inv, n, (a) => NAV.test(a.tag), true);
    if (ex !== undefined) return put(n, "dynamic", "strong", [`the page marks this as data (data-dyn="${ex}")`], { existing: true, name: ex });
    if (n.textKind === "attribute") {
      if (n.details.dynamic) return put(n, "dynamic", "strong", [`the ${n.attr} attribute is an expression in the source`]);
      return put(n, "static", "strong", [`${n.a11y ? "accessibility text" : "text in a prop"} (${n.attr}): fixed wording that people and screen readers read`]);
    }
    if (n.textKind === "expression") return put(n, "dynamic", "strong", ["an expression in the source: the code already computes it"], { name: nameFor(n, rule) });
    if (n.parent && byId.get(n.parent)?.details && ancestor(inv, n, (a) => a.kind === "cell" && a.details.header)) return put(n, "static", "strong", ["a column header"], extra);
    // strong rule of the import block outside a repeated row
    const varying = slots.filter((s) => s.varies).sort((a, b) => (a.listStrength === "strong" ? 0 : 1) - (b.listStrength === "strong" ? 0 : 1))[0], constant = slots.length && !varying;
    const rowStrength = varying?.listStrength ?? "strong";
    if (rule && rule.sug.strength === "strong" && !constant) {
      const p = put(n, "dynamic", "strong", [rule.sug.reason, ...(varying ? [`differs across the rows: ${varying.examples.map((x) => `"${x}"`).join(", ")}`] : []), ...(col?.header ? [`under the column "${col.header}"`] : [])], { risk: rule.sug.risk, name: rule.sug.name, ruleId: rule.sug.id, ...extra });
      if (rule.tokens) p.tokens = rule.tokens;
      if (rule.whole) p.whole = rule.whole;
      return p;
    }
    // the label of a control
    if (inCtl) return put(n, "static", "strong", [`the label of a control (${inCtl.tag})`]);
    // text inside a repeated row: dynamic unless it is identical in every row
    if (constant) return put(n, "static", "strong", [`the same in all ${slots[0].group.count ?? slots[0].values.length} rows: "${slots[0].examples[0]}"`], { ...extra, ...(rule ? { ruleId: rule.sug.id } : {}) });
    if (varying) {
      const p = put(n, "dynamic", rowStrength, [`differs across the ${varying.group.count ?? varying.values.length} rows: ${varying.examples.map((x) => `"${x}"`).join(", ")}`, ...(col?.header ? [`under the column "${col.header}"`] : [])], { name: nameFor(n, rule), ...(rule ? { ruleId: rule.sug.id } : {}), ...extra });
      if (rule?.whole) p.whole = rule.whole;
      if (rule?.tokens) p.tokens = rule.tokens;
      return p;
    }
    // the contract
    if (contract) {
      const hits = contract.lookup(t);
      if (hits.length) {
        const coincidence = /^[+\-−]?\d{1,2}$/.test(t) || hits.every((h) => h.source === "aggregate");
        const h = hits[0];
        const p = put(n, "dynamic", coincidence ? "weak" : "strong", [`equals the API example ${h.field}${h.formatter === "asText" ? "" : ` (as ${h.formatter})`}`], {
          risk: coincidence ? (hits.every((x) => x.source === "aggregate") ? "matches a total or count of the list, which may be a coincidence" : "a short number can equal an API value by coincidence") : null,
          name: rule?.sug.name ?? nameFor(n, rule), contract: hits.slice(0, 3), ...(rule ? { ruleId: rule.sug.id } : {}), ...extra });
        if (rule?.whole) p.whole = rule.whole;
        if (rule?.tokens) p.tokens = rule.tokens;
        return p;
      }
    }
    // numbers inside a sentence that equal an API example value: only those tokens are data (strong)
    if (contract && n.textKind !== "expression") {
      const raw = source.slice(n.start, n.end);
      const hit = [];
      for (const m of raw.matchAll(RE_NUM_TOKEN)) {
        const tok = m[0].replace(/[.,]+$/, "");
        const hs = contract.lookup(tok);
        if (!hs.length || /^[+\-−]?\d{1,2}$/.test(tok) || hs.every((h) => h.source === "aggregate") || /^(19|20)\d{2}$/.test(tok)) continue;
        const start = n.start + m.index;
        const planned = rule?.tokens?.find((x) => x.start === start);
        hit.push({ start, end: start + tok.length, name: planned?.name ?? labelBefore(n) ?? "value", ruleId: planned?.ruleId, text: tok, field: hs[0].field });
      }
      const whole = words(t).length > 1 || hit.length && hit[0].text !== t;
      if (hit.length && whole) {
        const p = put(n, "dynamic", "strong", hit.map((h) => `"${h.text}" equals the API example ${h.field}`), { risk: "the rest of the sentence stays fixed wording", tokens: hit.map(({ start, end, name, ruleId }) => ({ start, end, name: name || "value", ...(ruleId ? { ruleId } : {}) })), name: hit[0].name || "value", partial: true, ...extra });
        if (rule) p.ruleId = rule.sug.id;
        return p;
      }
    }
    if (rule) { // a weak rule of the import block
      const s = rule.sug, risky = RISKY.test(s.risk ?? "");
      const p = put(n, risky ? "unsure" : "dynamic", "weak", [s.reason, ...(col?.header ? [`under the column "${col.header}"`] : [])], { risk: s.risk, name: s.name, ruleId: s.id, ...(risky ? { lean: "dynamic" } : {}), ...extra });
      if (rule.tokens) p.tokens = rule.tokens;
      if (rule.whole) p.whole = rule.whole;
      return p;
    }
    if (col && !slots.length) return put(n, "dynamic", "weak", [`a cell under the column "${col.header || col.index + 1}"`], { risk: "only one row in the design, so it cannot be compared with another row", name: nameFor(n, rule), ...extra });
    // prose that mentions an API value
    const mentions = contract && words(t).length >= 3 ? contract.mentions(t) : [];
    if (mentions.length) return put(n, "unsure", "weak", [`mentions ${mentions.map((m) => `"${m}"`).join(", ")}, which the API returns`], { risk: "may be a generated sentence (dynamic) or fixed copy that happens to name it", lean: "dynamic", mentions, name: nameFor(n, rule), ...extra });
    if (unitSuffix(n)) return put(n, "unsure", "weak", [`"${t}" sits right after a number: probably the unit of that value`], { risk: "may be fixed wording next to a data value", lean: "dynamic" });
    const stat = statLabel(n);
    if (stat) return put(n, "static", "strong", [`the label of a stat: it sits above "${stat}"`]);
    if (inNav) return put(n, "static", "strong", ["a navigation label"]);
    return put(n, "static", contract ? "strong" : "weak", contract ? ["no number, date or API value matches it"] : ["no rule fired, and there is no API contract to compare it with"], { risk: contract ? null : "with no contract nothing says the text is not data" });
  };
  for (const n of textNodes.concat(nodes.filter((x) => x.kind === "text" && x.textKind === "attribute"))) textOfPropose(n);
  // instances share the name of their template
  for (const inst of Object.keys(follow)) {
    const root = rootOf(follow, inst);
    if (P[inst] && P[root]?.name && P[inst].cls === P[root].cls) P[inst].name = P[root].name;
  }
  const issues = {};
  for (const p of Object.values(P)) {
    const n = byId.get(p.id);
    if (p.cls === "unsure") issues[p.id] = "ambiguous";
    else if (n.kind === "text" && p.cls === "static" && p.strength === "weak" && !p.existing) issues[p.id] = "unclassified";
  }
  return { proposals: P, issues, follow };
}

/**
 * The id a decision for `id` is stored under: the outermost template (an instance of a repeated row follows its template).
 *
 * @param {Object<string,string>} templateOf The `follow` map from `classify()` (instance -> template).
 * @param {string} id Node id.
 * @returns {string} The template's id, or `id` itself.
 */
export function rootOf(templateOf, id) {
  let cur = id;
  const seen = new Set();
  while (templateOf[cur] && !seen.has(cur)) { seen.add(cur); cur = templateOf[cur]; }
  return cur;
}

/**
 * The class a node ends up with, given its proposal and the user's decision (if any).
 *
 * @param {object} node Inventory node.
 * @param {Proposal} proposal The node's proposal.
 * @param {{act:"accept"|"reject"|"change"|"add", cls?:string, name?:string}|undefined} decision The user's decision.
 * @returns {{cls:string, strength:string, status:"accepted"|"rejected"|"changed"|"added"|"proposed"|"none", name:string|null}}
 *   `status`: accepted (the user said yes, or the page already had the marker), rejected, changed (another class), added (no proposal), proposed (waiting), none (nothing to decide).
 */
export function effectiveOf(node, proposal, decision) {
  const wait = proposal.cls === "structure" ? "none" : proposal.existing ? "accepted" : "proposed";
  if (!decision) return { cls: proposal.cls, strength: proposal.strength, status: wait, name: proposal.name ?? null };
  if (decision.act === "accept") return { cls: proposal.cls === "unsure" ? (proposal.lean ?? "static") : proposal.cls, strength: proposal.strength, status: "accepted", name: decision.name ?? proposal.name ?? null };
  if (decision.act === "reject") return { cls: node.kind === "text" ? "static" : "structure", strength: "strong", status: "rejected", name: null };
  return { cls: decision.cls, strength: "strong", status: proposal.cls === "structure" ? "added" : "changed", name: decision.name ?? proposal.name ?? null };
}

/**
 * The coverage figure: every node is in exactly one bucket, so the buckets add up to the total.
 *
 * @param {ReturnType<typeof import("./inventory.mjs").buildInventory>} inv The inventory.
 * @param {Object<string,{cls:string,status:string}>} effective `effectiveOf` for every node id.
 * @returns {{total:number, dynamic:number, static:number, list:number, action:number, input:number, visual:number, structure:number, unsure:number, accountedFor:number, sentence:string}}
 *   `list` counts lists, tables and rows; `structure` layout only. `accountedFor` is 100 when the buckets add up.
 */
export function coverage(inv, effective) {
  const total = inv.nodes.length - 1;
  const c = { total, dynamic: 0, static: 0, list: 0, action: 0, input: 0, visual: 0, structure: 0, unsure: 0 };
  for (const n of inv.nodes) if (n.id !== "root") c[effective[n.id].cls] = (c[effective[n.id].cls] ?? 0) + 1;
  const sum = CLASS_KEYS.reduce((s, k) => s + c[k], 0);
  // The user's rule: text that is neither marked nor static is static at least, so an unsure node counts as static until it is decided.
  return { ...c, staticAtLeast: c.static + c.unsure, accountedFor: total ? Math.round((sum / total) * 100) : 100, sentence: `${total} nodes: ${c.dynamic} dynamic, ${c.static} static copy, ${c.action} actions, ${c.input} inputs, ${c.list} list parts, ${c.visual} visuals, ${c.structure} structure, ${c.unsure} unsure (static until decided)` };
}
