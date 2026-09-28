// "What would close this?" For every part the matcher can't settle, work out from the mock data
// what edit would settle it — and, after the answers are in, list what is still open.
//   computeHints(m)      right after matching: id -> { kind: tie | missing | gap, why, hint }
//   openItems(m, hints)  after answers: everything still open, with its hint

const q = (v) => JSON.stringify(v);
const NEEDS = { create: "POST", update: "PUT", remove: "DELETE", list: "GET", save: "POST and PUT", reload: "GET" };

import { flatItems, requestFields } from "./match.mjs";

/**
 * Work out, from the mock data, what edit would settle each part the matcher could not. Call once, right after
 * matching, before any answer is applied.
 *
 * @param {object} m The match result (`match()`'s return value).
 * @returns {Map<string, {id: string, part: string, kind: "tie"|"missing"|"gap", why: string, hint: string,
 *   viaContract?: true}>}
 *   A hint per unsettled part id (`list.<name>`, `list.sort`, `value.<name>`, `action.<scope>.<name>`,
 *   `form.<name>`/`form.missing.<name>`, `gap.<i>`); `viaContract` marks a hint whose real cause is a missing/
 *   unusable contract.
 */
export function computeHints(m) {
  const hints = new Map();
  const put = (id, part, kind, why, hint, viaContract = false) => hints.set(id, { id, part, kind, why, hint, ...(viaContract ? { viaContract } : {}) });
  // No contract (or no example in it): the reason is the contract, said once per part, not a list of per-field guesses.
  const block = m.block ?? null;
  const items = flatItems(m.endpoints);
  // Fields the contract declares for the list but gives no example for: worth naming next to "missing".
  const listLabel = m.endpoints.list ? `${m.endpoints.list.method} ${m.endpoints.list.path}` : null;
  const undeclared = (m.contract?.gaps ?? []).filter((g) => g.kind === "field-no-example" && g.where === "response" && g.endpoint === listLabel).map((g) => g.path.replace(/^\w*\[\]\./, ""));
  const withDeclared = (hint) => (undeclared.length ? `${hint} The contract declares these fields but gives no example for them: ${undeclared.join(", ")}; an example on each would let them be matched.` : hint);
  const idField = "id" in (items[0] ?? {}) ? "id" : Object.keys(items[0] ?? {})[0];
  const idx = m.list?.alignedIdx ?? [];
  const idOf = (i) => items[idx[i]]?.[idField];

  for (const f of m.list?.fields ?? []) {
    const fields = [...new Set(f.candidates.map((c) => c.field))];
    if (f.candidates.length > 1 && fields.length > 1) {
      const [a, b] = fields;
      put(`list.${f.name}`, `row.${f.name}`, "tie",
        `${fields.map(q).join(" and ")} both reproduce ${f.examples.map(q).join(", ")}, so the mock data can't tell them apart.`,
        `Make them differ in at least one row. For example, in the row with ${idField} ${idOf(0)}, change ${q(b)} to something other than ${q(f.examples[0])}. Whichever field still shows ${q(f.examples[0])} is then the match.`);
    } else if (f.candidates.length > 1) {
      put(`list.${f.name}`, `row.${f.name}`, "tie",
        `${f.candidates.map((c) => c.formatter).join(" and ")} give identical text for ${q(fields[0])} in every row.`,
        `Add a row whose value formats differently (for example a number of 1000 or more), so only one formatter reproduces the design.`);
    } else if (!f.candidates.length && block) {
      put(`list.${f.name}`, `row.${f.name}`, "missing", block.partWhy, block.partHint, true);
    } else if (!f.candidates.length) {
      const pairs = f.examples.slice(0, 4).map((e, i) => `${idField} ${idOf(i)} → ${q(e)}`).join(", ");
      put(`list.${f.name}`, `row.${f.name}`, "missing",
        `No API field, with any built-in format, produces ${f.examples.map(q).join(", ")}.`,
        withDeclared(`If the API has it, add a field to the GET response with these values per row (${pairs}); it closes as soon as you re-run. Otherwise answer with a placeholder, or leave the TODO.`));
    }
  }

  const sorts = m.list?.sort ?? [];
  if (m.list && sorts.length !== 1) {
    put("list.sort", "row order", sorts.length ? "tie" : "missing",
      sorts.length ? `${sorts.map((s) => s.label).join("; ")} ${sorts.length === 2 ? "both" : "all"} give the designed order for these ${idx.length} rows.` : `No sort on any field gives the designed row order.`,
      sorts.length ? `Add or edit a row so these orders differ (for example give the last row the largest value of the second field). The sort that still matches the design is then the right one.` : `Add a field the design is sorted by, or answer "keep the API order".`);
  }

  for (const v of m.values) {
    const c = v.candidates;
    if (c.length > 1) {
      const fields = [...new Set(c.map((x) => x.field))];
      const ext = (agg, field) => {
        const vals = items.map((it) => Number(it[field]));
        return items[vals.indexOf(agg === "max" ? Math.max(...vals) : Math.min(...vals))]?.[idField];
      };
      const extremes = c.filter((x) => x.agg === "max" || x.agg === "min").map((x) => `${x.agg}(${x.field}) is at ${idField} ${ext(x.agg, x.field)}`);
      put(`value.${v.name}`, v.name, "tie",
        `${c.map((x) => `${x.agg}(${x.field ?? ""})`).join(" and ")} ${c.length === 2 ? "both" : "all"} give ${q(v.example)}.`,
        extremes.length > 1
          ? `They peak on the same row (${extremes.join(", ")}). Change ${fields.map(q).join(" or ")} on that row, or add a row where they peak differently.`
          : `Change ${fields.map(q).join(" or ")} in at least one row so the results differ.`);
    } else if (!c.length && block) {
      put(`value.${v.name}`, v.name, "missing", block.partWhy, block.partHint, true);
    } else if (!c.length) {
      put(`value.${v.name}`, v.name, "missing",
        `Nothing computed from the list (count, sum, average, min, max) gives ${q(v.example)}.`,
        withDeclared(`If the data exists, add it as a field on each item so an aggregate can produce it. Otherwise answer with a placeholder (controller or a new endpoint), or leave the TODO.`));
    }
  }

  const actions = [...(m.list?.actions ?? []), ...m.actions];
  for (const a of actions) {
    const id = `action.${a.scope}.${a.name}`;
    if (!a.kind) {
      put(id, `${a.name} (${a.scope} action)`, "missing",
        `"${a.name}" isn't a verb the tool knows (${Object.keys({ create: 1, add: 1, update: 1, save: 1, delete: 1, remove: 1, edit: 1, select: 1, cancel: 1, reset: 1, refresh: 1 }).join(", ")}).`,
        `Rename it in the design (data-action) to a known verb, or answer with your own placeholder handler.`);
    } else if (a.missing.length && block?.kind === "missing") {
      put(id, `${a.name} (${a.scope} action)`, "missing", `"${a.name}" looks like "${a.kind}", but there is no API contract to say which endpoint it calls.`, block.partHint, true);
    } else if (a.missing.length) {
      put(id, `${a.name} (${a.scope} action)`, "missing",
        `"${a.name}" looks like "${a.kind}", but the API for it (${a.missing.join(", ")}) wasn't given.`,
        `Add a ${a.missing.map((k) => NEEDS[k]).join(" and ")} endpoint to the API contract (the feature's OpenAPI file: edit it or upload a new one); it is wired as soon as you re-run.`);
    }
  }

  const reqExample = requestFields(m.endpoints);
  for (const f of m.forms[0]?.fields ?? []) {
    if (!(f.name in reqExample) && block?.kind === "missing") {
      put(`form.${f.name}`, `input ${f.name}`, "gap", `The form has an input "${f.name}", but there is no API contract to say what the request expects.`, block.partHint, true);
    } else if (!(f.name in reqExample)) {
      put(`form.${f.name}`, `input ${f.name}`, "gap",
        `The form has an input "${f.name}" but no example request body has it.`,
        `Add "${f.name}" to the request example of the POST/PUT in the API contract (the feature's OpenAPI file), or remove the input from the design.`);
    }
  }
  for (const k of Object.keys(reqExample).filter((k) => !m.forms[0]?.fields.some((f) => f.name === k))) {
    put(`form.missing.${k}`, `input ${k}`, "gap",
      `The API request expects "${k}" but the form has no input for it.`,
      `Add an input named "${k}" to the design's form, or remove "${k}" from the request example.`);
  }
  m.gaps.forEach((g, i) => put(`gap.${i}`, "page", "gap", g, `Fix the input named in the message, then re-run.`));
  return hints;
}

// What is still open once the answers are applied.
/**
 * Everything still open after the answers are applied: unresolved ties, missing data, skipped questions and
 * placeholders, each with its hint.
 *
 * @param {object} m The match result, after answers have been applied.
 * @param {Map<string, object>} hints From {@link computeHints}.
 * @returns {{id: string, part: string, state: "missing"|"skipped"|"placeholder"|"tie"|"gap", why: string,
 *   hint: string, origin: string|null, viaContract?: true}[]}
 *   The open items, in a fixed order (contract first, if it is the blocker).
 */
export function openItems(m, hints) {
  const out = [];
  const add = (id, state, why, hint) => out.push({ id, part: hints.get(id)?.part ?? id, state, why, hint, origin: hints.get(id)?.kind ?? null, ...(hints.get(id)?.viaContract ? { viaContract: true } : {}) });
  // One item for the contract itself, first: it is what closes everything marked viaContract.
  if (m.block) out.push({ id: m.block.id, part: m.block.part, state: "missing", why: m.block.why, hint: m.block.hint, origin: "missing" });
  const judge = (id, c) => {
    const h = hints.get(id);
    // a part that only waits for the contract is missing, not "skipped"
    if (c?.skipped) return add(id, h?.viaContract ? "missing" : "skipped", h?.why ?? "skipped for now", h?.hint ?? "Answer it in the next run.");
    if (c?.todo) return add(id, "missing", h?.why ?? "not in the API", h?.hint ?? "Add it to the API, then re-run.");
    if (c?.custom) {
      const layer = { fields: "domain", controller: "controller", api: "service", handler: "controller" }[c.from];
      return add(id, "placeholder", `${c.fn}() is a placeholder in the ${layer} layer.`,
        `Write the real logic in ${c.fn}()` + (h ? `, or close it by data: ${h.hint}` : "."));
    }
  };
  for (const f of m.list?.fields ?? []) judge(`list.${f.name}`, f.candidates.length > 1 ? null : f.candidates[0]);
  for (const v of m.values) judge(`value.${v.name}`, v.candidates.length > 1 ? null : v.candidates[0]);
  for (const f of m.list?.fields ?? []) if (f.candidates.length > 1) add(`list.${f.name}`, "tie", hints.get(`list.${f.name}`)?.why ?? "tied", hints.get(`list.${f.name}`)?.hint ?? "");
  for (const v of m.values) if (v.candidates.length > 1) add(`value.${v.name}`, "tie", hints.get(`value.${v.name}`)?.why ?? "tied", hints.get(`value.${v.name}`)?.hint ?? "");
  if (m.list?.sort?.[0]?.skipped) judge("list.sort", m.list.sort[0]);
  else if ((m.list?.sort?.length ?? 1) !== 1) add("list.sort", "tie", hints.get("list.sort")?.why ?? "tied", hints.get("list.sort")?.hint ?? "");
  for (const a of [...(m.list?.actions ?? []), ...m.actions]) {
    const id = `action.${a.scope}.${a.name}`;
    if (a.skipped) judge(id, { skipped: true });
    else if (a.kind === "custom") judge(id, { custom: true, from: "handler", fn: a.fn });
    else if (a.kind === "ignore" || !a.kind) add(id, "missing", hints.get(id)?.why ?? "no behaviour chosen", hints.get(id)?.hint ?? "Choose what it does, or a placeholder.");
  }
  for (const h of hints.values()) if (h.kind === "gap") add(h.id, "gap", h.why, h.hint);
  return out;
}
