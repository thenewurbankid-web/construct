// States and conditionals: what the design shows only sometimes, found in the markup and listed as STATE RECORDS (kind
// "state") linked to the element they affect, each with the condition text and a proposed requirement item for Product or
// Design. Pure and deterministic: no model, no I/O. State records are not tree nodes (the tree's 100% coverage and every
// node id stay as they are); they have their own stable ids (`s` + hash of file, position, source and kind).
//
// Sources, in the order they are looked for:
//   conditional  `cond && <X/>`, `a ? <X/> : <Y/>`, a `.map()` with an empty branch: the element inside is shown only when the condition holds
//   prop         disabled, aria-disabled / -selected / -expanded / -busy / -checked / -pressed / -invalid / -current, selected, active, loading, checked,
//                expanded, and `variant="selected|active|disabled|error|loading"`
//   class        a class token that names a state (`selected`, `active`, `disabled`, `loading`, `error`, `animate-pulse`, `skeleton`)
//   text         loading / empty / error wording ("Loading...", "No results", "Something went wrong")
//   skeleton     a skeleton or animate-pulse element or tag
import { sha1 } from "./shape.mjs";

const STATE_PROPS = { disabled: "disabled", "aria-disabled": "disabled", "aria-selected": "selected", selected: "selected", active: "selected", "aria-current": "selected", "aria-expanded": "expanded", expanded: "expanded", "aria-busy": "loading", loading: "loading", "aria-checked": "checked", checked: "checked", "aria-pressed": "checked", "aria-invalid": "error", error: "error" };
const VARIANT_WORDS = /^(selected|active|disabled|loading|checked|expanded)$/i; // (a colour variant such as Badge variant="error" is a style, not a state)
const CLASS_TOKEN = /^(is-)?(selected|active|disabled|loading|error)$|^(animate-pulse|skeleton)$/;
const TEXT_STATE = [
  ["loading", /^(loading|please wait|fetching|saving|updating)\b|\.\.\.$|…$/i],
  ["empty", /^(no (results|data|items|matches|records)|nothing (here|to show|found)|no .{1,30} (yet|found|available)|empty|not found)\b/i],
  ["error", /^(something went wrong|an error|error\b|failed\b|could not|couldn't|try again|unable to)/i],
];
const COND_KIND = [
  ["empty", /length\s*(===?|<|<=)\s*[01]\b|!\s*[\w.?]+\.length|\bis?empty\b|\bnoResults?\b|\bempty\b/i],
  ["loading", /\b(is)?loading\b|\bpending\b|\bfetching\b|\bisFetching\b|\bskeleton\b/i],
  ["error", /\b(is)?error\b|\bfailed\b|\bisError\b/i],
  ["selected", /\b(is)?(selected|active|open)\b/i],
  ["disabled", /\bdisabled\b/i],
];

// who has to write the requirement, and what to ask
const REQUIRE = {
  conditional: ["Product", (c, t) => `Define when ${t} is shown: \`${c}\`. Is the condition right, and what does the user see otherwise?`],
  empty: ["Product", (c, t) => `Define the empty state of ${t}: when is it empty (\`${c}\`), what does it say, what can the user do?`],
  loading: ["Design", (c, t) => `Design the loading state of ${t}${c ? ` (\`${c}\`)` : ""}: skeleton or spinner, what stays visible, what is disabled.`],
  error: ["Product", (c, t) => `Define the error state of ${t}${c ? ` (\`${c}\`)` : ""}: which errors, the wording, and the way to retry.`],
  disabled: ["Design", (c, t) => `Design the disabled state of ${t} and Product: when is it disabled${c && c !== "true" ? ` (\`${c}\`)` : ""}?`],
  selected: ["Design", (c, t) => `Design the selected/active variant of ${t} and Product: what selects it${c && c !== "true" ? ` (\`${c}\`)` : ""}?`],
  expanded: ["Design", (c, t) => `Design the expanded and collapsed variants of ${t}; what opens it?`],
  checked: ["Design", (c, t) => `Design the checked and unchecked variants of ${t}; what is stored?`],
};
const kindOfCondition = (c) => COND_KIND.find(([, re]) => re.test(c))?.[0] ?? "conditional";

// The condition that guards ONE element inside a conditional expression: the text before the element, up to its operator.
function conditionBefore(exprSrc, exprStart, elStart) {
  const head = exprSrc.slice(1, elStart - exprStart).replace(/[\s(]+$/, "");
  if (/&&$/.test(head)) return { condition: head.replace(/&&$/, "").trim().replace(/^\(+/, ""), branch: "then" };
  if (/\?$/.test(head)) return { condition: head.replace(/\?$/, "").trim().replace(/^\(+/, "").replace(/^.*\?\s*(?=[^?]*$)/, (m) => (m.includes(":") ? "" : m)), branch: "then" };
  if (/:$/.test(head)) { const c = head.split("?")[0].trim().replace(/^\(+/, ""); return { condition: c, branch: "else" }; }
  if (/\|\|$/.test(head)) return { condition: `not (${head.replace(/\|\|$/, "").trim()})`, branch: "then" };
  return null; // no operator right before the element (a slot, an arrow-function body): nothing guards it here
}

const cls = (props) => (typeof props?.className === "string" ? props.className : "");

/**
 * Find the states and conditionals of a page.
 *
 * @param {{nodes:object[], byId:Map<string,object>}} inv The inventory being built (nodes with `via`, `props`, `spans`, `start`, `end`).
 * @param {string} source The page source.
 * @param {string} file File name (part of every id).
 * @returns {object[]} State records in source order: `{id, kind:"state", stateKind, source, target, condition, branch, prop?, line, col, start, end, team, requirement}`.
 */
export function detectStates(inv, source, file) {
  const out = [];
  const seen = new Set();
  const used = new Set();
  const lineCol = (offset) => { const before = source.slice(0, offset); const line = before.split("\n").length; return { line, col: offset - before.lastIndexOf("\n") }; };
  const label = (n) => (n.kind === "text" ? `"${n.text.slice(0, 40)}"` : `<${n.tag}>`);
  const add = (n, stateKind, from, condition, extra = {}) => {
    const key = `${n.id}|${stateKind}|${from}|${condition}|${extra.prop ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const at = extra.at ?? n.start;
    const { line, col } = lineCol(at);
    let len = 8, id;
    do { id = "s" + sha1(`${file}|${line}:${col}|${from}|${stateKind}|${extra.prop ?? ""}|${condition}`).slice(0, len); len += 2; } while (used.has(id));
    used.add(id);
    const [team, ask] = REQUIRE[stateKind] ?? REQUIRE.conditional;
    const { at: _at, ...rest } = extra; // eslint-disable-line no-unused-vars
    out.push({ id, kind: "state", stateKind, source: from, target: n.id, condition, branch: "then", ...rest, line, col, start: at, end: extra.end ?? n.end, team, requirement: ask(condition, label(n)) });
  };
  for (const n of inv.nodes) {
    if (n.id === "root") continue;
    if (n.kind === "text") {
      if (n.textKind === "attribute" || n.textKind === "expression") continue;
      const hit = TEXT_STATE.find(([, re]) => re.test(n.text));
      const parent = inv.byId.get(n.parent);
      if (hit && n.text.length <= 80 && !out.some((x) => x.target === parent.id && x.stateKind === hit[0])) add(parent, hit[0], "text", `text "${n.text.slice(0, 40)}"`, { at: n.start, end: n.end });
      continue;
    }
    // conditional rendering: the element sits inside an expression that decides whether it exists
    if (n.via?.cond && n.via.src) {
      const c = conditionBefore(n.via.src, n.via.start, n.start);
      if (c?.condition) add(n, kindOfCondition(c.condition), "conditional", c.branch === "else" ? `not (${c.condition})` : c.condition, { branch: c.branch });
    }
    // props
    for (const a of n.spans?.attrs ?? []) {
      const kind = STATE_PROPS[a.name];
      const text = source.slice(a.start, a.end);
      const value = text.includes("=") ? text.slice(text.indexOf("=") + 1).replace(/^\{|\}$/g, "").trim() : "true";
      if (kind && !/^(false|"false"|null|undefined)$/.test(value)) add(n, kind, "prop", value, { prop: a.name, at: a.start, end: a.end });
      if (a.name === "variant" && typeof n.props.variant === "string" && VARIANT_WORDS.test(n.props.variant)) add(n, n.props.variant.toLowerCase().replace(/^active$/, "selected"), "prop", `variant="${n.props.variant}"`, { prop: "variant", at: a.start, end: a.end });
    }
    // class tokens and skeletons
    const tokens = cls(n.props).split(/\s+/).filter(Boolean);
    const tok = tokens.find((t) => CLASS_TOKEN.test(t));
    if (tok) add(n, /pulse|skeleton/.test(tok) ? "loading" : tok.replace(/^is-/, ""), /pulse|skeleton/.test(tok) ? "skeleton" : "class", `class "${tok}"`);
    else if (/skeleton/i.test(n.tag)) add(n, "loading", "skeleton", `<${n.tag}>`);
  }
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}
