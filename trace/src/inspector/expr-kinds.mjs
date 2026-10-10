// Managed-expression kind detection shared by the Part inspector (state.mjs) and the live-run pipeline
// (pipeline.mjs), so the AST walk for a given kind is written once.
// R6.50 landed "if" only; LIN-224 moves "ternary" and "switch" in here too, same pattern, so the live-run rail
// (trace.mjs) sees the same detectors the inspector already used. "list" stays in state.mjs: its UI is a
// ×N grouping in the endpoint panel, not a rail glyph/bind, so it does not share this module's shape.
import { buildInventory } from "../pagemap/inventory.mjs";
import { sha1 } from "../pagemap/shape.mjs";

// Top-level `?` links in a plain-value chained ternary (`a?x:b?y:z` has 2), ignoring `?.` (optional chaining) and
// any `?`/`:` nested inside brackets/parens/braces/strings (a `?` inside a string literal is not a ternary link).
function ternaryLinks(text) {
  let depth = 0, links = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "?" && text[i + 1] !== "." && depth === 0) links++;
  }
  return links;
}
// The discriminant of a chained ternary's first comparison (`a === "x" ? ... `), when it has one.
const ternaryDiscriminant = (text) => text.match(/^\(?\s*([A-Za-z_$][\w$.]*)\s*===?\s*/)?.[1] ?? null;

// A `cond && <X/>` conditional (states.mjs, via buildInventory) with no matching "else" branch: one synthetic
// part per unmatched conditional, keyed by the state record's own id (the "s<hash>" shape inspector.mjs's
// PART_ID already recognises as openable).
export function ifExprParts(source, spec) {
  const parts = [];
  const inv = buildInventory(source, { file: spec.page });
  const conditionals = inv.states.filter((s) => s.source === "conditional");
  // states.mjs stores an "else" branch's condition as `not (${condition})` (detectStates' own `add()` call),
  // never the bare text a "then" branch carries -- so matching a then/else pair on this same condition needs
  // that wrapping accounted for, not a plain string equality.
  const elseOf = (cond) => conditionals.find((o) => o.branch === "else" && o.condition === `not (${cond})`);
  for (const rec of conditionals) {
    if (rec.branch !== "then") continue;
    if (elseOf(rec.condition)) continue; // a ternary/if-with-else: a separate kind, not this one
    parts.push({ id: rec.id, label: `Conditional: ${rec.condition}`, exprKind: "if", exprCondition: rec.condition });
  }
  return parts;
}

// LIN-224: the "ternary" kind (spec §2/§3) -- the same `states.mjs` conditional detector's "then"/"else" pair,
// when both branches exist (`a ? <X/> : <Y/>`), the one case ifExprParts above deliberately skips. One part per
// condition, keyed by the "then" branch's own id (its "else" counterpart's id is kept alongside for a later
// branch-editing panel, spec §4b, not built yet -- same deferral "if"/"list" already took).
export function ternaryExprParts(source, spec) {
  const parts = [];
  const inv = buildInventory(source, { file: spec.page });
  const conditionals = inv.states.filter((s) => s.source === "conditional");
  const elseOf = (cond) => conditionals.find((o) => o.branch === "else" && o.condition === `not (${cond})`);
  for (const rec of conditionals) {
    if (rec.branch !== "then") continue;
    const elseRec = elseOf(rec.condition);
    if (!elseRec) continue; // no else: that's "if", not this kind
    parts.push({ id: rec.id, label: `Ternary: ${rec.condition}`, exprKind: "ternary", exprCondition: rec.condition, exprElseId: elseRec.id });
  }
  return parts;
}

// LIN-224: the "switch" kind (spec §2) -- a lookup/dispatch object indexed by a discriminant variable
// (`LOOKUP[x]`), or a chained ternary with 3+ links (`a===x?A:a===y?B:a===z?C:D`) -- both found directly in a
// plain value expression's own source text (`buildInventory`'s `textKind:"expression"` text nodes already carry
// the raw `{...}` contents, no new parsing). A chain with only 2 links stays a plain value (JSX ternaries,
// `cond ? <X/> : <Y/>`, are the separate "ternary" kind above; a 2-link plain-value chain is not surfaced as any
// managed kind, same threshold the spec fixes at §2/§10.4 so only one option is ever offered for a given chain).
export function switchExprParts(source, spec) {
  const parts = [];
  const inv = buildInventory(source, { file: spec.page });
  for (const n of inv.nodes) {
    if (n.kind !== "text" || n.textKind !== "expression") continue;
    const text = n.text.trim();
    const lookup = text.match(/^([A-Za-z_$][\w$]*)\s*\[\s*([A-Za-z_$][\w$.]*)\s*\](?:\s*(?:\?\?|\|\|)\s*.+)?$/);
    const links = ternaryLinks(text);
    if (!lookup && links < 3) continue;
    const discriminant = lookup ? lookup[2] : ternaryDiscriminant(text) ?? text;
    const id = "s" + sha1(`${spec.page}|switch|${n.id}`).slice(0, 8);
    parts.push({ id, label: `Switch: ${discriminant}`, exprKind: "switch", exprCondition: discriminant });
  }
  return parts;
}

// All rail-bindable kinds ("if"/"ternary"/"switch") in one call, for the live-run pipeline (pipeline.mjs) --
// same inputs, one AST build is still three `buildInventory` calls today (matching state.mjs's own pattern;
// not worth short-circuiting to one pass for three small per-example page files).
export function allExprParts(source, spec) {
  return [...ifExprParts(source, spec), ...ternaryExprParts(source, spec), ...switchExprParts(source, spec)];
}
