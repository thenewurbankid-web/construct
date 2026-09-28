// Builds the tree model (design part → transform → API) from the matcher's state.
// It reads candidates directly, so the same code draws every stage of a run:
//   found   only the design parts, straight from extract
//   matched exact matches resolved, ambiguous ones amber, unmatched ones red
//   final   every question answered
// States: ok · static (kept from the design) · ask (needs your answer) · missing (red) ·
// placeholder (you chose to build it later; violet).
import { ACTION_KINDS, requestFields, endpointFields, knownVerb } from "../match.mjs";
import { makeNames } from "../plan.mjs";
import { fnNames, eventName } from "../emit.mjs";

const node = (title, sub, state = "ok") => ({ title, sub, state });
const bad = (title, sub) => node(title, sub, "missing");
const ask = (title, sub) => node(title, sub, "ask");
const still = (title, sub) => node(title, sub, "static");
const holder = (title, sub) => node(title, sub, "placeholder");
// A red cell whose part has an open Ask (nobody has answered yet). `waiting: true` is what the demo's vocabulary reads to say
// Waiting instead of Gap (src/ui/vocab.mjs): it is a fact of the pipeline, so rewording `sub` or `title` can never flip it.
const waiting = (n) => Object.assign(n, { waiting: true });
// Which generated layer a node lands in (drawn as a chip), and whether it is a transform (drawn with ƒ).
const at = (n, layer, kind) => (n ? Object.assign(n, { layer, kind }) : n);
// A ViewModel entry that isn't a plain live mirror of the page ("manual" or "linked"): metadata only, not a
// tree state (ok/ask/missing/placeholder), so src/ui/vocab.mjs is untouched.
const origin = (n, o) => (n && o && o !== "auto" ? Object.assign(n, { origin: o }) : n);

const SHORT = {
  create: ["create", "POST"], update: ["update", "PUT"], save: ["create / update", "POST+PUT"],
  remove: ["delete", "DELETE"], reload: ["reload list", "GET"],
  select: ["select row", null], clear: ["clear selection", null], ignore: ["not wired", null],
};

const summarize = (groups) => {
  const leaves = groups.flatMap((g) => g.leaves);
  const has = (l, s) => l.cells.some((c) => c?.state === s);
  const open = (l) => !has(l, "missing") && !has(l, "ask");
  return {
    total: leaves.length,
    missing: leaves.filter((l) => has(l, "missing")).length,
    ask: leaves.filter((l) => !has(l, "missing") && has(l, "ask")).length,
    placeholder: leaves.filter((l) => open(l) && has(l, "placeholder")).length,
  };
};

const finish = (groups, spec, sub, found = false) => {
  for (const g of groups) {
    const n = g.leaves.filter((l) => l.cells.some((c) => c?.state === "missing")).length;
    const a = g.leaves.filter((l) => !l.cells.some((c) => c?.state === "missing") && l.cells.some((c) => c?.state === "ask")).length;
    const p = g.leaves.filter((l) => !l.cells.some((c) => c?.state === "missing" || c?.state === "ask") && l.cells.some((c) => c?.state === "placeholder")).length;
    g.node = node(g.title, n ? `${n} of ${g.leaves.length} missing` : a ? `${a} need an answer` : p ? `${p} placeholder${p > 1 ? "s" : ""} to build` : sub(g), n ? "missing" : a ? "ask" : p ? "placeholder" : "ok");
  }
  const s = summarize(groups);
  return {
    root: node(spec.feature, found ? `${spec.route} · ${s.total} parts found` : `${spec.route} · ${s.missing ? s.missing + " missing" : s.ask ? s.ask + " to answer" : s.placeholder ? s.placeholder + " placeholders" : "all connected"}`, s.missing ? "missing" : s.ask ? "ask" : s.placeholder ? "placeholder" : "ok"),
    groups,
    stats: s,
  };
};

// ---- stage 1: only the ViewModel's live-page shape (auto/manual/linked entries) ----
/**
 * Build the "found" stage of the match tree: only the design parts, straight from the ViewModel, before any
 * matching has happened.
 *
 * @param {object} vm The ViewModel (see `viewmodel.mjs`).
 * @param {{feature: string, route: string}} spec The example's spec.
 * @returns {{root: object, groups: object[], stats: {total: number, missing: number, ask: number,
 *   placeholder: number}}}
 *   The tree: a root node, one group per part kind (values/list/actions/form), and summary stats.
 */
export function foundTree(vm, spec) {
  const groups = [];
  const group = (key, title) => { const g = { key, title, leaves: [] }; groups.push(g); return g; };
  const part = (g, id, title, sub, o) => g.leaves.push({ id, cells: [origin(node(title, sub), o), null, null] });
  if (vm.values.length) {
    const g = group("values", "Page values");
    for (const v of vm.values) part(g, `value.${v.name}`, v.name, `design shows "${v.example}"`, v.origin);
  }
  const list = vm.lists[0];
  if (list) {
    const g = group("list", `List: ${list.name}`);
    for (const f of list.fields) part(g, `list.${f}`, `row.${f}`, `e.g. "${list.rows[0]?.[f]}"`, list.origin);
    part(g, "list.sort", "row order", "as designed", list.origin);
  }
  const acts = [...(list?.actions ?? []).map((a) => ["row", a]), ...vm.actions.map((a) => ["page", a.name])];
  if (acts.length) {
    const g = group("actions", "Actions");
    for (const [scope, name] of acts) part(g, `action.${scope}.${name}`, name, scope === "row" ? "row button" : "page button", scope === "row" ? list?.origin : vm.actions.find((a) => a.name === name)?.origin);
  }
  if (vm.forms[0]) {
    const g = group("form", "Form");
    for (const f of vm.forms[0].fields) part(g, `form.${f.name}`, `input ${f.name}`, f.type, vm.forms[0].origin);
  }
  return finish(groups, spec, (g) => `${g.leaves.length} found`, true);
}

// ---- stages 2+: matched / final ----
/**
 * Build the "matched"/"final" stage of the match tree: each design part, its transform, and the API it comes
 * from (or why it doesn't yet) — the same builder for both stages, since candidates are read directly from `m`.
 *
 * @param {object} m The match result (before or after answers are applied).
 * @param {{feature: string, route: string}} spec The example's spec.
 * @returns {{root: object, groups: object[], stats: {total: number, missing: number, ask: number,
 *   placeholder: number}}}
 *   The tree, in the same shape as {@link foundTree}'s result.
 */
export function buildTree(m, spec) {
  const e = m.endpoints;
  const ref = (ep) => (ep ? `${ep.method} ${ep.path}` : "");
  const listRef = ref(e.list);
  const N = makeNames(spec.feature), F = fnNames(N);
  const rowsFn = `to${N.Item}Rows`, inputFn = `to${N.Item}Input`;
  const svc = (fn, ep) => at(node(fn, ep), "Service");
  const groups = [];
  const group = (key, title) => { const g = { key, title, leaves: [] }; groups.push(g); return g; };
  const add = (g, id, part, tf, api) => g.leaves.push({ id, cells: [part, tf, api] });

  // With no contract (or no example in it) everything that needed data is missing for that one reason.
  const why = m.block?.kind === "missing" ? "no API contract" : "no example in the contract";
  const nodata = () => [bad("no transform", why), bad(why, "upload a Swagger/OpenAPI file")];
  // Turns a field/value's candidates into transform + API nodes.
  const explain = (c, describe) => {
    if (c.length > 1) return [ask(`${c.length} possible matches`, "pick one"), ask("which field?", listRef)];
    if (m.block && (!c.length || c[0].skipped || c[0].todo)) return nodata();
    if (!c.length) return [bad("no transform", "nothing in the API gives this"), waiting(bad("not in API", "needs your answer"))];
    const x = c[0];
    if (x.skipped) return [ask("skipped for now", "answer later"), ask("waiting for an answer", "")];
    if (x.static) return [still("static text", "kept from the design"), null];
    if (x.todo) return [bad("no transform", "nothing in the API gives this"), bad("not in API", "TODO in generated code")];
    if (x.custom) return custom(x);
    return describe(x);
  };
  // A part the user chose to build by hand: a named placeholder function in the layer they picked.
  const custom = (x) => {
    if (x.from === "fields") return [at(holder(`${x.fn}()`, "placeholder function"), "Domain", "transform"), at(node(x.inputs.join(" + "), `${F.list}() · ${listRef}`), "Service")];
    if (x.from === "controller") return [at(holder(`${x.fn}()`, "placeholder function"), "Controller", "transform"), holder("from the controller", "no API involved")];
    return [at(holder(`${x.fn}()`, "placeholder call"), "Service", "transform"), holder("new endpoint", "not defined yet")];
  };

  if (m.values.length) {
    const g = group("values", "Page values");
    for (const v of m.values) {
      const cells = explain(v.candidates, (x) => [
        at(node(x.formatter === "asText" ? x.agg : `${x.agg} → ${x.formatter}`, `${v.name}(items)`), "Domain", "transform"),
        svc(x.field ?? "whole list", `${F.list}() · ${listRef}`),
      ]);
      add(g, `value.${v.name}`, at(node(v.name, `design shows "${v.example}"`), "Page"), ...cells);
    }
  }

  if (m.list) {
    const g = group("list", `List: ${m.list.name}`);
    if (!e.list) add(g, "list.none", bad(m.list.name, m.block ? why : "no list endpoint given"), null, bad(m.block ? "no list endpoint" : "no GET returning an array", ""));
    for (const f of m.list.fields) {
      const cells = explain(f.candidates, (x) => [
        at(node(x.formatter === "asText" ? "as text" : x.formatter, `${rowsFn}()`), "Domain", x.formatter === "asText" ? undefined : "transform"),
        svc(x.field, `${F.list}() · ${listRef}`),
      ]);
      add(g, `list.${f.name}`, at(node(`row.${f.name}`, `e.g. "${f.examples[0]}"`), "Component"), ...cells);
    }
    const s = m.list.sort;
    const sp = at(node("row order", "as designed"), "Page");
    if (s[0]?.skipped) add(g, "list.sort", sp, ask("skipped for now", "answer later"), ask("waiting for an answer", ""));
    else if (s.length !== 1) add(g, "list.sort", sp, ask(`${s.length || "no"} possible sorts`, "pick one"), ask("which field?", listRef));
    else if (s[0].field) add(g, "list.sort", sp, at(node(`sort ${s[0].dir === "asc" ? "ascending" : "descending"}`, `${rowsFn}()`), "Domain", "transform"), svc(s[0].field, `${F.list}() · ${listRef}`));
    else add(g, "list.sort", sp, still("keep API order", ""), null);
  }

  const actions = [...(m.list?.actions ?? []), ...m.actions];
  if (actions.length) {
    const g = group("actions", "Actions");
    for (const a of actions) {
      const id = `action.${a.scope}.${a.name}`;
      const part = at(node(a.name, a.scope === "row" ? "row button" : "page button"), a.scope === "row" ? "Component" : "Page");
      if (!a.kind) { add(g, id, part, ask("what should it do?", "unknown verb"), ask("?", "")); continue; }
      if (a.skipped && m.block?.kind === "missing" && knownVerb(a.name)) { add(g, id, part, bad("no API contract", "which endpoint?"), bad("endpoint missing", "upload a Swagger/OpenAPI file")); continue; }
      if (a.skipped) { add(g, id, part, ask("skipped for now", "answer later"), ask("waiting for an answer", "")); continue; }
      if (a.kind === "custom") { add(g, id, part, at(holder(`${a.fn}()`, "placeholder handler"), "Controller"), still("no API call", "yet")); continue; }
      const [label, verb] = SHORT[a.kind] ?? [ACTION_KINDS[a.kind], null];
      if (a.kind === "ignore") { add(g, id, part, bad("not wired", "no behaviour chosen"), bad("no API call", "button does nothing")); continue; }
      const eps = { create: [e.create], update: [e.update], save: [e.create, e.update], remove: [e.remove], reload: [e.list] }[a.kind];
      const svcFn = { create: [F.create], update: [F.update], save: [F.create, F.update], remove: [F.remove], reload: [F.list] }[a.kind];
      const ev = at(node(label, `event ${eventName(a.name)}`), "Workflow");
      if (!eps) add(g, id, part, ev, still("no API call", ""));
      else if (eps.every(Boolean)) add(g, id, part, ev, svc(eps.map((x) => x.method).join(" / "), `${svcFn.join(" / ")}() · ${eps[0].path}`));
      else add(g, id, part, ev, waiting(bad("endpoint missing", `needs ${verb}`)));
    }
  }

  if (m.forms[0]) {
    const g = group("form", "Form");
    const reqTypes = requestFields(e);
    const bodyOf = (k) => [e.create, e.update].filter((x) => x && k in endpointFields(x)).map((x) => x.method).join(" / ");
    for (const f of m.forms[0].fields) {
      const part = at(node(`input ${f.name}`, f.type), "Page");
      if (bodyOf(f.name)) add(g, `form.${f.name}`, part, at(node(`to ${reqTypes[f.name]}`, `${inputFn}()`), "Domain", "transform"), svc(f.name, `${bodyOf(f.name)} body`));
      else if (m.block?.kind === "missing") add(g, `form.${f.name}`, part, bad("no request field", "no API contract"), bad("no API contract", "upload a Swagger/OpenAPI file"));
      else add(g, `form.${f.name}`, part, bad("no request field", "no example body has it"), bad("not in API", `${f.name} would be dropped`));
    }
    for (const k of Object.keys(reqTypes).filter((k) => !m.forms[0].fields.some((f) => f.name === k))) {
      add(g, `form.missing.${k}`, bad("no input", `API expects "${k}"`), at(node("form → request", `${inputFn}()`), "Domain", "transform"), svc(k, `${bodyOf(k)} body`));
    }
  }

  if (m.gaps.length) {
    const g = group("gaps", "Gaps");
    m.gaps.forEach((t, i) => add(g, `gap.${i}`, bad("gap", t), null, null));
  }
  return finish(groups, spec, (g) => `${g.leaves.length} connected`);
}
