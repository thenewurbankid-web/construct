// Suggest where the three markers (data-dyn, data-list, data-action) belong in a page that has none.
// Pure and deterministic: no model, no I/O, same source -> same list. Every suggestion is one yes/no question
// ("Is $38.4M data from the API?"), so a wizard can ask them one click at a time; applyMarkers() writes the yes answers.
//
// Rules (see README "Importing real Subframe pages"):
//   dyn    text that looks like money/number, date, percent, delta (▲/▼), "N of M"
//   list   3+ sibling elements with the same structure, or Table.Row / <tr> children (first = template)
//   action Button / IconButton / button / a with an onClick or type=submit
//   form   <form>, and Input-like fields (adds the `name` extract needs)
// A rule that is often wrong in real pages lowers the suggestion to "weak" and says why in `risk`.
import { parsePage, attrOf } from "./parse.mjs";
import { kids, textOf } from "./extract-parts.mjs";

/**
 * @typedef {object} Suggestion
 * @property {string} id         stable across runs: `<kind>-<line>:<column>`
 * @property {"dyn"|"list"|"action"|"form"} kind
 * @property {{line:number, column:number}} loc  1-based position of the element (or of the wrapped token)
 * @property {string} text       what the user would see in the question (matched text, first row, button label)
 * @property {string} reason     which rule fired
 * @property {"strong"|"weak"} strength
 * @property {string|null} risk  why it may be a false positive (always set when weak, unless the rule itself is weak)
 * @property {string} name       the marker value that applyMarkers would write (`totalSpend`, `categories`, `open`)
 * @property {string} tag        tag of the element that gets the attribute (`span` for a wrapped token)
 * @property {string} question   the yes/no question, ready to show
 */

const KIND_ORDER = { list: 0, dyn: 1, action: 2, form: 3 };
const KNOWN_VERBS = {
  create: "create", add: "create", new: "create", update: "update", save: "save", submit: "submit", delete: "delete",
  remove: "delete", edit: "edit", select: "select", open: "open", cancel: "cancel", reset: "reset", close: "close",
  refresh: "refresh", reload: "refresh",
};
// Elements whose subtree is navigation chrome; anything suggested inside is weak.
const NAV_TAG = /(^|\.)(nav|aside)$|SideNav|Sidebar|Breadcrumbs?|^Tabs?(\.|$)|^TopbarWithRightNav|NavItem|Menu/;
const CHIP_TAG = /(Badge|Chip|Tag|Pill|Avatar)$/;
const TOGGLE_TAG = /^(Switch|Toggle|ToggleGroup|Checkbox|Radio)(\.|$)/;
const HEADER_CELL = /(^th$)|(HeaderCell$)/;
// A standalone sentence styled or tagged as a heading, or as body/narrative copy (Subframe's `text-hN`/`text-bodyN`
// scale, with or without the `-max` responsive variant). Deliberately excludes `subtitle`/`overline`/`caption`,
// which this codebase's fixtures use for section titles and small labels, not narrative content.
const HEADLINE_CLASS = /\btext-(h[1-6]|body-\d)(-max)?\b/i;
const HEADING_TAG = /^h[1-6]$/;
// A thin full-width rule next to a heading marks a plain section-title row (e.g. "Category overview"), not a
// narrative sentence: this codebase's fixtures pair every static section title with one of these.
const DIVIDER_CLASS = /\bh-px\b/;

// dyn patterns on the whole text of one element
const RE_NUMBER = /^[+\-−]?[$€£]?[+\-−]?\d[\d,.]*[KMB%]?$/; // spec: ^[$€£]?-?[\d,.]+[KMB%]?$ (plus a leading sign, at least one digit)
const RE_RANGE = /^[$€£]?\d[\d,.]*[KMB]?\s?[-–−]\s?[$€£]?\d[\d,.]*[KMB%]?$/;
const RE_DELTA = /^[▲▼]\s?[+\-−]?[$€£]?\d[\d,.]*[KMB%]?(\s\w+)?$/;
const RE_DATE = /^\d{1,2} \w{3} \d{4}$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/;
const RE_N_OF_M = /^\d+ of \d+$/;
const RE_VERSION = /^v?\d+\.\d+\.\d+([-+.\w]*)$/;
const RE_YEAR = /^(19|20)\d{2}$/;
const RE_ORDINAL = /^0\d$/;
const RE_LABELLED_NUMBER = /^(?:[A-Za-z]+ )?[+\-−]?[$€£]?\d[\d,.]*[KMB%]?(?: [\w%$.,+\-−·<>]+){0,5}$/;
// tokens inside a sentence; `#`/`&` are excluded before the digits so an entity like &#8722; is not a number
// Exported so eval/pagemap.mjs can find the value embedded in a weak "label + number" proposal, without a second
// copy of this pattern drifting from this one.
export const RE_TOKEN = /\d+ of \d+|(?<![\w.$€£#&])[$€£]?\d[\d,.]*[KMB%]?(?![\w])/g;

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const words = (s) => (s.match(/[A-Za-z0-9]+/g) ?? []);
const camel = (s, n = 4) => {
  const w = words(s).slice(0, n).map((x) => x.toLowerCase());
  return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join("");
};

function classifyWhole(t) {
  if (RE_VERSION.test(t)) return { reason: "looks like a number", strength: "weak", risk: "looks like a version string" };
  if (RE_YEAR.test(t)) return { reason: "looks like a number", strength: "weak", risk: "a bare year is usually static copy" };
  if (RE_ORDINAL.test(t)) return { reason: "looks like a number", strength: "strong", ordinal: true, risk: null };
  if (RE_ISO.test(t)) return { reason: "matches an ISO date", strength: "strong", risk: null };
  if (RE_DATE.test(t)) return { reason: "matches a date (D Mon YYYY)", strength: "strong", risk: null };
  if (RE_N_OF_M.test(t)) return { reason: 'matches "N of M"', strength: "strong", risk: null };
  if (RE_DELTA.test(t)) return { reason: "matches a ▲/▼ delta", strength: "strong", risk: null };
  if (RE_NUMBER.test(t)) return { reason: /%$/.test(t) ? "matches a percent" : "matches money/number", strength: "strong", risk: null };
  if (RE_RANGE.test(t)) return { reason: "matches a number range", strength: "strong", risk: null };
  if (/\d+ of \d+/.test(t) && t.length <= 40) return { reason: '"N of M" with words around it', strength: "weak", risk: "static count in copy (e.g. 4 of 14 selected)" };
  if (t.length <= 40 && RE_LABELLED_NUMBER.test(t)) return { reason: "label that starts with or holds a number", strength: "weak", risk: "may be a static label; the number is part of a phrase" };
  return null;
}

/**
 * Analyse a page and return the suggestions together with the edits that would apply them.
 * Internal to the module family (applyMarkers uses it); suggestMarkers() is the public view.
 *
 * @param {string} source JSX or TSX page source.
 * @returns {{suggestion: Suggestion, edit: object}[]} Sorted plan entries.
 */
export function planMarkers(source) {
  const page = parsePage(source);
  const els = page.elements.filter((e) => e.kind === "element");
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const locOf = (offset) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };
  const anc = (el, pred) => { for (let p = el.parent; p; p = p.parent) if (pred(p)) return p; return null; };
  const inNav = (el) => !!(NAV_TAG.test(el.tag) || anc(el, (p) => NAV_TAG.test(p.tag)));
  const isSkeleton = (el) => {
    const cls = (e) => `${e.tag} ${attrOf(e, "className") ?? ""} ${attrOf(e, "class") ?? ""}`;
    return /skeleton|animate-pulse/i.test(cls(el)) || !!anc(el, (p) => /skeleton|animate-pulse/i.test(cls(p)));
  };
  const elKids = (el) => kids(el).filter((c) => c.kind === "element");
  const hasText = (el) => kids(el).some((c) => (c.kind === "text" && c.text.trim()) || (c.kind === "element" && hasText(c)));
  const within = (inner, outer) => inner !== outer && inner.start >= outer.start && inner.end <= outer.end;
  const textCount = (el) => kids(el).reduce((n, c) => n + (c.kind === "text" && c.text.trim() ? 1 : c.kind === "element" ? textCount(c) : 0), 0);
  const shape = (el) => `${el.tag}(${elKids(el).map(shape).join(",")})`;

  const plan = [];
  const push = (kind, at, fields, edit) => {
    const loc = locOf(at);
    plan.push({
      suggestion: { id: `${kind}-${loc.line}:${loc.column}`, kind, loc, risk: null, ...fields },
      edit: { kind, ...edit },
    });
  };

  // ---- lists ----
  const listParents = []; // {parent, rows}
  const inAnyRow = (node) => listParents.some((l) => l.rows.some((r) => within(node, r) || node === r));
  for (const P of els) {
    if (attrOf(P, "data-list")) { listParents.push({ parent: P, rows: elKids(P), existing: true }); continue; }
    if (inAnyRow(P)) continue; // repeated things inside a row are that row's fields, not another list
    const rowKids = elKids(P);
    if (!rowKids.length || rowKids.some((k) => HEADER_CELL.test(k.tag))) continue; // a header row is not data
    let rows = null, reason = "", risk = null, strength = "strong";
    const tableRows = rowKids.filter((r) => (r.tag === "Table.Row" || r.tag === "tr") && !els.some((e) => within(e, r) && HEADER_CELL.test(e.tag)));
    if (tableRows.length && tableRows.some(hasText)) {
      rows = tableRows;
      reason = `${tableRows.length} ${tableRows[0].tag} children (the first is the template)`;
      if (tableRows.length !== rowKids.length) { strength = "weak"; risk = "the parent also holds non-row children; the extractor treats every child as a row"; }
    } else {
      const groups = new Map();
      for (const r of rowKids) { const h = shape(r); groups.set(h, [...(groups.get(h) ?? []), r]); }
      const best = [...groups.values()].filter((g) => g.length >= 3).sort((a, b) => b.length - a.length || a[0].start - b[0].start)[0];
      if (!best || !hasText(best[0])) continue;
      rows = best;
      reason = `${best.length} sibling <${best[0].tag}> elements with the same structure`;
      if (best.length !== rowKids.length) { strength = "weak"; risk = "the parent also holds other children; the extractor treats every child as a row"; }
    }
    const chips = rows.every((r) => CHIP_TAG.test(r.tag)) || rows.every((r) => !elKids(r).length && collapse(textOf(r)).length <= 24);
    const isTableRow = rows[0].tag === "Table.Row" || rows[0].tag === "tr";
    if (chips && !isTableRow) { strength = "weak"; risk = "looks like a chip/tag row, not data rows"; }
    else if (!isTableRow && textCount(rows[0]) < 3) { strength = "weak"; risk = "rows carry fewer than 3 texts (a stat strip, legend or label/value pairs?)"; }
    if (inNav(P)) { strength = "weak"; risk = "inside navigation (sidebar or menu items are usually static)"; }
    if (isSkeleton(P)) { strength = "weak"; risk = "skeleton/loading placeholder"; }
    // Only a strong list is treated as "the rows" (names, nesting); a weak one may be declined.
    if (strength === "strong") listParents.push({ parent: P, rows, existing: false });
    push("list", P.start, {
      text: `${rows.length} rows, first: "${collapse(textOf(rows[0])).slice(0, 60)}"`,
      reason, strength, risk, name: "", tag: P.tag,
      question: `Is this a repeated list of ${rows.length} rows (the first row is the template)?`,
    }, { el: P, attr: "data-list", value: null, ref: P });
    plan[plan.length - 1].parentRef = P;
  }
  const rowOf = (node) => { for (const l of listParents) for (const r of l.rows) if (node === r || within(node, r)) return { list: l, row: r }; return null; };

  // ---- dyn ----
  const dyn = [];
  const allText = [];
  for (const el of els) for (const c of el.children) if (c.kind === "text" && c.text.trim()) allText.push({ el, c, t: collapse(c.text) });
  const skipTag = /^(script|style|code|pre)$/;
  for (const { el, c, t } of allText) {
    if (skipTag.test(el.tag) || HEADER_CELL.test(el.tag) || attrOf(el, "data-dyn")) continue;
    const whole = collapse(textOf(el));
    const cls = el.children.filter((x) => x.kind === "text" && x.text.trim()).length === 1 ? classifyWhole(whole) : null;
    if (cls) {
      if (dyn.some((d) => d.el === el)) continue;
      let { strength, risk } = cls;
      const row = rowOf(el);
      if (cls.ordinal && !row) { strength = "weak"; risk = "leading-zero number outside a list (nav/step numbering?)"; }
      if (inNav(el)) { strength = "weak"; risk = "inside navigation (sidebar, breadcrumbs, tabs)"; }
      else if (isSkeleton(el)) { strength = "weak"; risk = "skeleton/loading placeholder"; }
      else if (anc(el, (p) => /^(Button|IconButton|button|a)$/.test(p.tag)) || /^(Button|IconButton|button|a)$/.test(el.tag)) { strength = "weak"; risk = "text of a button"; }
      dyn.push({ el, whole, strength, risk, reason: cls.reason, at: el.start, whole_: true });
      continue;
    }
    // Any other text in a row of a strong list is probably a row field (a name, a badge): weak, the pattern rules cannot see it.
    const inRow = rowOf(el);
    if (inRow && whole === t && !dyn.some((d) => d.el === el) && !anc(el, (p) => /^(Button|IconButton|button|a)$/.test(p.tag)) && !/^(Button|IconButton|button|a)$/.test(el.tag)) {
      dyn.push({ el, whole, strength: "weak", risk: "may be a static label; it sits in a list row, where text is usually a field", reason: "text inside a list row", at: el.start });
      continue;
    }
    // A headline or narrative sentence outside any list: no digit/date/delta rule can see it, so the only signal
    // left is that it is tagged or styled as a heading (h1-h6, text-hN) or as body copy (text-bodyN), and is not
    // the divider-adjacent kind of heading a plain, static section title uses (see DIVIDER_CLASS above).
    if (!inRow && whole === t && !dyn.some((d) => d.el === el) && words(whole).length >= 3) {
      const cln = attrOf(el, "className");
      const isHeadlineStyle = HEADING_TAG.test(el.tag) || (typeof cln === "string" && HEADLINE_CLASS.test(cln));
      if (isHeadlineStyle) {
        const siblingDivider = (el.parent ? kids(el.parent) : []).some((s) => s !== el && s.kind === "element" && typeof attrOf(s, "className") === "string" && DIVIDER_CLASS.test(attrOf(s, "className")));
        const isButtonish = anc(el, (p) => /^(Button|IconButton|button|a)$/.test(p.tag)) || /^(Button|IconButton|button|a)$/.test(el.tag);
        if (!siblingDivider && !isButtonish && !inNav(el) && !isSkeleton(el)) {
          dyn.push({ el, whole, strength: "weak", risk: "matches no fixed dyn pattern; judged only by heading/body-copy styling, so it may be static copy", reason: "headline or narrative sentence, outside any list", at: el.start });
          continue;
        }
      }
    }
    // Numbers inside a sentence: weak, wrapped in a <span> (the element's own text is not all data).
    if (whole.split(" ").length < 3 || c.fromExpr) continue;
    const raw = source.slice(c.start, c.end);
    for (const m of raw.matchAll(RE_TOKEN)) {
      const tok = m[0].replace(/[.,]+$/, "");
      if (RE_YEAR.test(tok)) continue;
      const start = c.start + m.index;
      dyn.push({ el, whole: tok, strength: "weak", risk: "a number inside a sentence may be static copy", reason: /of/.test(tok) ? 'an "N of M" count inside a sentence' : "a number inside a sentence", at: start, token: { start, end: start + tok.length } });
    }
  }
  const labelFor = (at) => {
    const prev = allText.filter((x) => x.c.start < at).slice(-8).reverse();
    for (const x of prev) {
      if (x.t.length < 3 || x.t.length > 50 || /\d/.test(x.t) || /[.!?]( |$)/.test(x.t) || !/[A-Za-z]{3}/.test(x.t) || classifyWhole(x.t)) continue;
      return camel(x.t);
    }
    return "";
  };
  const used = new Set(); // page-level names; row fields are unique per list, and lists have their own registry
  const unique = (base, reg = used) => { let n = base || "value", i = 1; while (reg.has(n)) n = `${base || "value"}${++i}`; reg.add(n); return n; };
  const rowUsed = new Map();
  const headerCache = new Map();
  const headersFor = (P) => {
    if (!headerCache.has(P)) {
      const table = /^(Table|table)$/.test(P.tag) ? P : anc(P, (p) => /^(Table|table)$/.test(p.tag)) ?? P;
      headerCache.set(P, els.filter((e) => within(e, table) && HEADER_CELL.test(e.tag)).map((e) => collapse(textOf(e))));
    }
    return headerCache.get(P);
  };
  const rowNames = new Map(); // "listStart|cell|ordinal" -> name, so every row gets the same field names
  const cellCount = new Map();
  dyn.sort((a, b) => a.at - b.at);
  for (const d of dyn) {
    const r = rowOf(d.el);
    if (r) {
      const cell = elKids(r.row).findIndex((k) => k === d.el || within(d.el, k));
      const hdr = headersFor(r.list.parent)[cell] ?? "";
      const base = hdr === "#" || /^(no\.?|rank)$/i.test(hdr) ? "rank" : camel(hdr) || `col${cell + 1}`;
      const ck = `${r.list.parent.start}|${cell}`;
      // ordinal of this candidate within its cell in *this row*
      const key = `${ck}|${r.row.start}`;
      const ord = cellCount.get(key) ?? 0;
      cellCount.set(key, ord + 1);
      const nk = `${ck}|${ord}`;
      if (!rowUsed.has(r.list.parent)) rowUsed.set(r.list.parent, new Set());
      if (!rowNames.has(nk)) rowNames.set(nk, unique(ord ? `${base}${ord + 1}` : base, rowUsed.get(r.list.parent)));
      d.name = rowNames.get(nk);
    } else d.name = unique(labelFor(d.at));
  }
  for (const d of dyn) {
    const nm = d.name;
    push("dyn", d.at, {
      text: d.whole, reason: d.reason, strength: d.strength, risk: d.risk, name: nm, tag: d.token ? "span" : d.el.tag,
      question: `Is "${d.whole}" data that comes from the API?`,
    }, d.token ? { wrap: d.token, attr: "data-dyn", value: nm } : { el: d.el, attr: "data-dyn", value: nm });
  }
  // list names: the nearest heading before the list, unique among lists
  const usedLists = new Set();
  for (const p of plan) {
    if (p.edit.kind !== "list") continue;
    const P = p.parentRef;
    const heading = allText.filter((x) => x.c.start < P.start).slice(-3).reverse().find((x) => x.t.length <= 40 && /[A-Za-z]{3}/.test(x.t) && !classifyWhole(x.t) && !/[.!?]$/.test(x.t));
    const base = P.tag.startsWith("Table") || P.tag === "tbody" || P.tag === "table" ? (camel(heading?.t ?? "", 2) || "rows") : camel(heading?.t ?? "", 2) || "items";
    p.suggestion.name = unique(base, usedLists);
    p.edit.value = p.suggestion.name;
    delete p.parentRef;
  }

  // ---- actions and forms ----
  const labelOf = (el) => {
    const own = collapse(textOf(el));
    if (own) return own;
    for (const a of ["aria-label", "title", "label"]) { const v = attrOf(el, a); if (typeof v === "string" && v) return v; }
    const icon = el.attrs.find((a) => a.name === "icon");
    const m = icon && source.slice(icon.start, icon.end).match(/Feather(\w+)|<(\w+)/);
    return m ? words(m[1] ?? m[2].replace(/^Feather/, "")).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2") : "";
  };
  for (const el of els) {
    const isButton = /^(Button|IconButton|button|a)$/.test(el.tag);
    if (isButton && !attrOf(el, "data-action") && (attrOf(el, "onClick") !== null || attrOf(el, "type") === "submit")) {
      const label = labelOf(el);
      const first = (words(label)[0] ?? "").toLowerCase();
      const verb = KNOWN_VERBS[first] ?? (camel(label, 3) || "action");
      let strength = "strong", risk = null;
      if (/^(cancel|close|back|dismiss|no|discard)$/i.test(first)) { strength = "weak"; risk = 'cancel/close buttons are UI-only ("cancel" is a known verb but rarely needs an API)'; }
      if (TOGGLE_TAG.test(el.tag) || attrOf(el, "aria-pressed") !== null || /^(toggle|expand|collapse|show|hide|switch)$/i.test(first)) { strength = "weak"; risk = "toggle/expand control: UI state, not an API action"; }
      if (/search/i.test(label)) { strength = "weak"; risk = "search control (UI filter)"; }
      if (inNav(el)) { strength = "weak"; risk = "inside navigation (breadcrumbs, sidebar, top bar)"; }
      if (isSkeleton(el)) { strength = "weak"; risk = "skeleton/loading placeholder"; }
      push("action", el.start, {
        text: label || "(no label)", reason: `${el.tag} with ${attrOf(el, "type") === "submit" ? "type=submit" : "an onClick"}`, strength, risk, name: verb, tag: el.tag,
        question: `Should the "${label || el.tag}" button do something (action "${verb}")?`,
      }, { el, attr: "data-action", value: verb });
    }
    // A row/card marked `clickable` (Subframe's tap-target idiom) is the whole action when nothing inside it
    // already has its own onClick/submit — e.g. a <Table.Row clickable={true}> whose only "button" is a
    // decorative chevron icon. When a real button already does the same job, that button is the suggestion
    // instead, so this never doubles up.
    if (!isButton && attrOf(el, "clickable") !== null && !attrOf(el, "data-action")) {
      const hasOwnButton = els.some((e) => e !== el && within(e, el) && /^(Button|IconButton|button|a)$/.test(e.tag) && (attrOf(e, "onClick") !== null || attrOf(e, "type") === "submit"));
      if (!hasOwnButton) {
        let strength = "strong", risk = null;
        if (inNav(el)) { strength = "weak"; risk = "inside navigation"; }
        if (isSkeleton(el)) { strength = "weak"; risk = "skeleton/loading placeholder"; }
        push("action", el.start, {
          text: "(clickable row)", reason: `${el.tag} with a clickable prop and no inner button`, strength, risk, name: "open", tag: el.tag,
          question: `Does this ${el.tag} open something when clicked (action "open")?`,
        }, { el, attr: "data-action", value: "open" });
      }
    }
    if (el.tag === "form" && !attrOf(el, "data-action")) {
      const submit = els.find((e) => within(e, el) && /^(Button|button)$/.test(e.tag) && attrOf(e, "type") === "submit");
      const label = submit ? labelOf(submit) : "";
      const verb = KNOWN_VERBS[(words(label)[0] ?? "").toLowerCase()] ?? (camel(label, 3) || "submit");
      push("form", el.start, {
        text: label || "form", reason: "a <form> element", strength: "strong", risk: null, name: verb, tag: "form",
        question: `Is this a form that sends data to the API (action "${verb}")?`,
      }, { el, attr: "data-action", value: verb });
    }
    if (/^(input|select|textarea|Input|TextField|Select|TextArea|Textarea)$/.test(el.tag) && typeof attrOf(el, "name") !== "string") {
      const lower = /^[a-z]/.test(el.tag);
      const hint = ["label", "placeholder", "aria-label"].map((a) => attrOf(el, a)).find((v) => typeof v === "string" && v) ?? "";
      const search = attrOf(el, "type") === "search" || /search|filter|find|query/i.test(`${hint} ${attrOf(el, "name") ?? ""}`);
      const inForm = !!anc(el, (p) => p.tag === "form");
      let strength = inForm && lower ? "strong" : "weak", risk = null;
      if (!inForm) risk = "no <form> around it, so nothing submits it";
      else if (!lower) risk = "a component field: the extractor only reads lowercase input/select/textarea names";
      if (search) { strength = "weak"; risk = "search box (a UI filter, not a form)"; }
      if (inNav(el)) { strength = "weak"; risk = "inside navigation"; }
      const nm = camel(hint, 3) || "field";
      push("form", el.start, {
        text: hint || el.tag, reason: `${el.tag} field without a name`, strength, risk, name: nm, tag: el.tag,
        question: `Is "${hint || el.tag}" a value the user enters and the API receives (name "${nm}")?`,
      }, { el, attr: "name", value: nm });
    }
  }

  // ---- duplicate sections ----
  // Subframe sometimes exports the exact same block twice (a copy-paste in the design tool, not a repeated-list
  // row: those are handled above and only read row 0). An action whose parent container has the same tag and
  // the same full text as an earlier, unrelated parent elsewhere on the page is probably that same duplicated
  // section, not a second, distinct action, so every occurrence after the first is downgraded to weak. Actions
  // inside an already-detected list row are left alone: repeating there is normal (one action per row).
  {
    const firstParentFor = new Map(); // signature -> the first parent element seen with it
    const actionEntries = plan
      .filter((p) => p.suggestion.kind === "action" && p.edit.el && !rowOf(p.edit.el))
      .sort((a, b) => a.edit.el.start - b.edit.el.start);
    for (const p of actionEntries) {
      const parent = p.edit.el.parent;
      if (!parent) continue;
      const sig = `${parent.tag}::${collapse(textOf(parent))}`;
      if (sig.length < 12) continue; // too short/trivial to call "a section"
      const first = firstParentFor.get(sig);
      if (first === undefined) { firstParentFor.set(sig, parent); continue; }
      if (first !== parent && p.suggestion.strength === "strong") {
        p.suggestion.strength = "weak";
        p.suggestion.risk = "an identical section (same container, same text) appears earlier on the page; this may be a duplicated block, not a second action";
      }
    }
  }

  plan.sort((a, b) => a.suggestion.loc.line - b.suggestion.loc.line || a.suggestion.loc.column - b.suggestion.loc.column
    || KIND_ORDER[a.suggestion.kind] - KIND_ORDER[b.suggestion.kind] || (a.suggestion.id < b.suggestion.id ? -1 : 1));
  return plan;
}

/**
 * Suggest markers for a page that has none. Deterministic and sorted by position.
 *
 * @param {string} source JSX or TSX page source.
 * @param {{strength?: "all"|"strong"}} [opts] `strength: "strong"` returns only the strong suggestions (default `"all"`).
 * @returns {Suggestion[]} Suggestions, each one a yes/no question; see the typedef for fields.
 * @throws {Error} When the source is not valid JSX/TSX.
 *
 * @example
 * suggestMarkers('export default () => <b>$5.6M</b>;')[0].kind; // => "dyn"
 */
export function suggestMarkers(source, opts = {}) {
  const all = planMarkers(source).map((p) => p.suggestion);
  return opts.strength === "strong" ? all.filter((s) => s.strength === "strong") : all;
}
