// Step 3 — turn every unresolved match into a question.
// Answers come from (in order): answers.json, the terminal or the web UI, or the first option (--yes).
// Every answer is saved back to answers.json, so the next run is fully repeatable.
//
// Nothing here is a closed list: every question also offers "something else", which opens ONE joint follow-up
// question (T12.4: where does it come from, which fields feed it, what is it called — answered together, not as
// three separate questions; the fields checklist is pre-checked by name evidence, see suggestedInputs below)
// and ends in a placeholder function that you name yourself. Question types: choice · multi · text · joint.
// Any question can also be skipped for now: the part is left as a TODO and the skip is not saved,
// so the next run with saved answers asks about it again.
import readline from "node:readline/promises";
import { ACTION_KINDS, flatItems, envScalars } from "./match.mjs";
import { bestByName, nameSimilarity } from "./name-evidence.mjs";
import { FORMS, formText, formOptions, partFormId, withTail } from "./questions/forms.mjs";

// T12.5: lexical name evidence for a tie. This orders a tied question's options (the option whose name best
// matches the design's own name for the part goes first) and labels it, but never removes an option or turns
// the tie into an accepted match — every tie is still asked (see name-evidence.mjs's file header for why: an
// auto-resolving version of this failed the eval gate on the "coupled" category, which exists to catch exactly
// that guess). `nameOf` reads the name to compare each candidate against.
function orderByNameEvidence(candidates, designName, nameOf) {
  if (candidates.length < 2) return { ordered: candidates, favored: null };
  const favored = bestByName(candidates, designName, nameOf);
  return favored ? { ordered: [favored, ...candidates.filter((c) => c !== favored)], favored } : { ordered: candidates, favored: null };
}

const SKIP = Symbol("skip");

/**
 * Describe a row-field candidate (a matched API field, with its formatter) for a question's option label.
 *
 * @param {{field: string, formatter: string}} c A candidate.
 * @returns {string} e.g. `API field "risk"` or `API field "risk" shown as percent`.
 */
export const describeField = (c) => (c.formatter === "asText" ? `API field "${c.field}"` : `API field "${c.field}" shown as ${c.formatter}`);
/**
 * Describe a page-value candidate (a response field, or an aggregate of the list) for a question's option label.
 *
 * @param {{agg: string, field?: string, formatter: string}} c A candidate.
 * @returns {string} e.g. `response field "total"` or `sum(risk) of the list, shown as money`.
 */
export const describeValue = (c) =>
  (c.agg === "field" ? `response field "${c.field}"` : `${c.agg}${c.field ? `(${c.field})` : ""} of the list`) + (c.formatter === "asText" ? "" : `, shown as ${c.formatter}`);

/**
 * Describe a "something else" placeholder answer (built via {@link customOption} or {@link adapterAnswer}) for
 * the saved-answer label.
 *
 * @param {{fn: string, from: "fields"|"controller"|"api"|"handler", inputs?: string[], adapter?: object}} v The
 *   custom answer.
 * @returns {string} e.g. `placeholder deriveTotal() combining risk, weight`.
 */
export const describeCustom = (v) =>
  `placeholder ${v.fn}()` +
  (v.adapter ? ` — via a saved adapter (${v.adapter.operationId} "${v.inputs[0]}", ${v.adapter.transform})`
    : v.from === "fields" ? ` combining ${v.inputs.join(", ")}`
    : v.from === "controller" ? ", provided by the controller"
    : v.from === "api" ? ", from a new API endpoint"
    : ", your own handler");

// LIN-190: the adapter dialog (Create adapter, docs/design/run-api-panel-and-wires.md §5) already picked a field,
// a transform and its params, with a live preview — it never needs ask.mjs's own "which fields feed it" follow-up.
// It reuses the SAME placeholder idiom customOption's "combine values from API fields" already produces (one
// "fields"-sourced candidate every downstream layer — plan.mjs, emit.mjs, tree/* — already knows how to turn
// into a placeholder function) rather than inventing a second answer-resolution mechanism; `adapter` is extra
// metadata (never read by codegen) so the saved-answer label and a future "apply the transform for real" can
// see where the value actually comes from.
function adapterAnswer(mapping) {
  return {
    custom: true,
    from: "fields",
    inputs: [mapping.field],
    fn: toIdentifier(mapping.fn, `derive${pascal(mapping.field)}`),
    adapter: { operationId: mapping.operationId, transform: mapping.transform, params: mapping.params ?? {} },
  };
}

const pascal = (s) => s.replace(/(^|[-_\s]+)(\w)/g, (_, __, c) => c.toUpperCase());

// Turn whatever the user typed into a valid JS identifier (camelCase), or fall back to the suggestion.
/**
 * Turn free text into a valid JS identifier (camelCase; a leading digit gets a `_` prefix), or fall back when the
 * result is empty.
 *
 * @param {*} text Whatever the user typed.
 * @param {string} fallback Used when `text` produces an empty identifier.
 * @returns {string} A valid identifier.
 */
export function toIdentifier(text, fallback) {
  const s = String(text ?? "").trim().replace(/[^A-Za-z0-9_$]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  const id = /^[0-9]/.test(s) ? "_" + s : s;
  return id || fallback;
}

// T12.4: which API fields to pre-check for "something else" → "combine values from API fields", using the same
// lexical name evidence as a tied question's ordering (T12.5) — any field with SOME evidence for the part's own
// name, not just the single best one (there is no "tie" to keep unresolved here: this only pre-fills a
// checklist the person still reviews and can change before the joint question is submitted; nothing is decided
// on its own).
function suggestedInputs(part, itemFields) {
  return itemFields.filter((f) => nameSimilarity(part, f) > 0);
}

// ---------- "something else": the placeholder builder ----------
// T12.4: one joint question replacing the three separate ones ("where does it come from?", "which fields?",
// "what should it be called?") this used to ask in sequence. All three are answered together; the fields
// checklist is pre-checked by name evidence (suggestedInputs, above) as a starting point, never a final answer.
function customOption({ part, scope, itemFields }) {
  const sources = [
    { label: "combine values from API fields — placeholder function in the domain layer", value: "fields" },
    { label: "provided by the controller — placeholder function in the controller", value: "controller" },
    ...(scope === "value" ? [{ label: "a new API endpoint that doesn't exist yet — placeholder call in the service", value: "api" }] : []),
  ];
  const defaultName = { fields: `derive${pascal(part)}`, controller: `get${pascal(part)}`, api: `fetch${pascal(part)}` };
  return {
    label: "something else — build a placeholder… (last resort — only if nothing above fits)",
    custom: {
      joint: () => ({
        type: "joint",
        text: `Where does "${part}" come from, which fields feed it (if any), and what should the placeholder be called?`,
        sources,
        itemFields: itemFields.map((f) => ({ label: `API field "${f}"`, value: f })),
        suggestedInputs: suggestedInputs(part, itemFields),
        defaultName,
      }),
      build: (acc) => ({
        custom: true,
        from: acc.from.value,
        inputs: (acc.inputs ?? []).map((o) => o.value),
        fn: toIdentifier(acc.fn, defaultName[acc.from.value]),
      }),
    },
  };
}

function customActionOption(a) {
  const fallback = `handle${pascal(a.name)}`;
  return {
    label: "something else — name my own handler (placeholder)…",
    custom: {
      steps: [() => ({ key: "fn", type: FORMS["handler-name"].type, text: formText("handler-name", { name: a.name }), default: fallback })],
      build: (acc) => ({ custom: true, from: "handler", fn: toIdentifier(acc.fn, fallback) }),
    },
  };
}

/**
 * Turn every unresolved match into a question (choice/multi/text), plus one "something else" option that opens a
 * placeholder-building follow-up chain. A part with exactly one candidate is skipped unless `all` is set.
 *
 * @param {object} m The match result (`list`, `values`, `actions`, `endpoints`, mutated by each question's
 *   `apply` once answered).
 * @param {{all?: boolean}} [options] `all`: also ask about parts that already have exactly one candidate.
 * @returns {object[]} The questions, each with `id`, `type`, `text`, `options`, `skipValue`, `apply`, and
 *   (for row/value questions) `isOpen`/`validCustom`.
 */
// What a part form needs to word itself (see src/questions/forms.mjs). A part the structural gate asked about
// (--structural, src/structural-gate.mjs) also carries the alternatives and the reason in plain words.
function partCtx(scope, part, example, m, flagged) {
  const texts = scope === "row" ? [...new Set(part.examples.map(String))].slice(0, 3) : [String(part.example)];
  return {
    scope, name: part.name, example, candidates: part.candidates,
    describe: scope === "row" ? describeField : describeValue,
    blockWhy: m.block?.partWhy,
    ...(flagged ? { alternatives: part.structural.alternatives ?? [], risk: part.structural.risk, samples: texts.map((t) => `"${t}"`).join(", ") } : {}),
  };
}

export function buildQuestions(m, { all = false } = {}) {
  const qs = [];
  const itemFields = Object.keys(flatItems(m.endpoints)[0] ?? {});
  const envFields = Object.keys(envScalars(m.endpoints)).map((p) => "data." + p); // page values may also be built from the response envelope

  for (const f of m.list?.fields ?? []) {
    const flagged = f.structural?.decision === "asked";
    const form = partFormId({ candidates: f.candidates, all, flagged });
    if (!form) continue;
    // T12.5: a tie (form "pick-one") orders its options by name evidence and labels the favored one, without
    // changing which parts are asked about (orderByNameEvidence is a no-op below two candidates).
    const { ordered, favored } = form === "pick-one" ? orderByNameEvidence(f.candidates, f.name, (c) => c.field) : { ordered: f.candidates, favored: null };
    const ctx = partCtx("row", { ...f, candidates: ordered }, f.examples[0], m, flagged);
    const opts = withTail(formOptions(form, ctx));
    if (favored) {
      const i = opts.findIndex((o) => o.value === favored);
      if (i !== -1) opts[i] = { ...opts[i], label: opts[i].label + " — closest name match" };
    }
    opts.push(customOption({ part: f.name, scope: "row", itemFields }));
    if (flagged) f.pendingConfirm = true;
    qs.push({
      id: `list.${f.name}`,
      type: FORMS[form].type,
      form,
      text: formText(form, ctx),
      options: opts,
      skipValue: { todo: true, skipped: true },
      isOpen: () => !!f.pendingConfirm || f.candidates.length !== 1 || all,
      // An adapter-sourced answer's field may live on an endpoint other than the list's own (that's the point of
      // an adapter), so it doesn't have to appear in itemFields the way a plain "combine API fields" answer does.
      validCustom: (v) => !!v.adapter || v.from !== "fields" || v.inputs.every((i) => itemFields.includes(i)),
      apply: (v) => { f.candidates = [v]; delete f.pendingConfirm; },
    });
  }

  if (m.list && m.list.sort.length !== 1) {
    const sortCtx = { name: m.list.name, sorts: m.list.sort };
    qs.push({
      id: `list.sort`,
      type: FORMS["pick-sort"].type,
      form: "pick-sort",
      text: formText("pick-sort", sortCtx),
      options: formOptions("pick-sort", sortCtx),
      skipValue: { field: null, dir: "none", label: "keep the API order", skipped: true },
      apply: (v) => { m.list.sort = [v]; },
    });
  }

  for (const v of m.values) {
    const flagged = v.structural?.decision === "asked";
    const form = partFormId({ candidates: v.candidates, all, flagged });
    if (!form) continue;
    const { ordered, favored } = form === "pick-one" ? orderByNameEvidence(v.candidates, v.name, (c) => (c.agg === "field" ? c.field : c.agg)) : { ordered: v.candidates, favored: null };
    const ctx = partCtx("value", { ...v, candidates: ordered }, v.example, m, flagged);
    const opts = withTail(formOptions(form, ctx));
    if (favored) {
      const i = opts.findIndex((o) => o.value === favored);
      if (i !== -1) opts[i] = { ...opts[i], label: opts[i].label + " — closest name match" };
    }
    opts.push(customOption({ part: v.name, scope: "value", itemFields: [...itemFields, ...envFields] }));
    if (flagged) v.pendingConfirm = true;
    qs.push({
      id: `value.${v.name}`,
      type: FORMS[form].type,
      form,
      text: formText(form, ctx),
      options: opts,
      skipValue: { todo: true, skipped: true },
      isOpen: () => !!v.pendingConfirm || v.candidates.length !== 1 || all,
      validCustom: (x) => !!x.adapter || x.from !== "fields" || x.inputs.every((i) => itemFields.includes(i) || envFields.includes(i)),
      apply: (x) => { v.candidates = [x]; delete v.pendingConfirm; },
    });
  }

  const actions = [...(m.list?.actions ?? []), ...m.actions];
  for (const a of actions) {
    if (a.kind && !a.missing.length && !all) continue;
    const needsOf = { create: ["create"], update: ["update"], save: ["create", "update"], remove: ["remove"], reload: ["list"] };
    const possible = Object.keys(ACTION_KINDS).filter((k) => (needsOf[k] ?? []).every((n) => m.endpoints[n]));
    if (a.kind && possible.includes(a.kind)) possible.unshift(...possible.splice(possible.indexOf(a.kind), 1));
    const actionCtx = { name: a.name, scope: a.scope, kind: a.kind, missing: a.missing, possible, labels: ACTION_KINDS };
    const opts = formOptions("action-kind", actionCtx);
    opts.push(customActionOption(a));
    qs.push({
      id: `action.${a.scope}.${a.name}`,
      type: FORMS["action-kind"].type,
      form: "action-kind",
      text: formText("action-kind", actionCtx),
      options: opts,
      skipValue: { skipped: true },
      apply: (k) => {
        a.skipped = !!k?.skipped;
        if (k?.skipped) a.kind = "ignore";
        else if (k?.custom) { a.kind = "custom"; a.fn = k.fn; }
        else { a.kind = k; a.fn = undefined; }
        a.missing = [];
      },
    });
  }
  return qs;
}

// ---------- answering ----------
// prompt(q, i, n) answers without the terminal (the web UI): an option index for "choice", an array of
// indices for "multi", a string for "text". onAnswer(q, choice, source) runs after each answer is applied;
// source is "saved" | "you" | "default".
/**
 * Answer every question, in order, from (in priority) a saved answer, an AI answer (only when it cites a fact),
 * an interactive prompt/terminal, or the first option (in `auto` mode a question with no saved/AI answer is left
 * open instead of guessed). Every non-skipped answer is applied via the question's `apply` and returned in
 * `answers`, so a later run with those saved answers is fully repeatable; a skipped answer is never saved, so it
 * is asked again next time.
 *
 * @param {object[]} questions From {@link buildQuestions}.
 * @param {object} [options]
 * @param {Record<string, *>} [options.answers] Previously saved answers, keyed by question id.
 * @param {boolean} [options.interactive] Prompt on the terminal when nothing else answers a question.
 * @param {(q: object, i: number, n: number) => Promise<*>} [options.prompt] Non-terminal answerer (the web UI):
 *   an option index for `"choice"`, an array of indices for `"multi"`, a string for `"text"`; return `{skip:true}`
 *   to skip.
 * @param {(q: object, choice: {label: string, value: *}, source: "saved"|"you"|"default"|"ai"|"skipped") => Promise<void>|void}
 *   [options.onAnswer] Called after each question is answered and applied.
 * @param {boolean} [options.auto] Never prompt; anything not answered by a saved/AI answer is left open.
 * @param {(q: object) => Promise<{label: string, value: *}|null>} [options.ai] Try an AI answer for a question
 *   (and for a placeholder follow-up); `null` means it declines and the question falls through.
 * @returns {Promise<{answers: Record<string, *>, log: {question: string, answer: string, skipped: boolean}[]}>}
 *   The updated saved answers and a log of what was asked and answered.
 */
export async function resolveQuestions(questions, { answers = {}, interactive = false, prompt = null, onAnswer = null, auto = false, ai = null }) {
  const saved = { ...answers };
  const rl = !prompt && interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const log = [];

  // T12.4: the joint follow-up question (source + fields + name, all at once). Returns { from, inputs, fn }
  // (raw values, not option objects — resolveQuestions' joint handling below maps them back) or SKIP. The AI
  // gets one fact-checked attempt at `from`/`inputs` (ai/index.mjs's answerJoint; the name is never AI-picked,
  // same as the old text-type "what's it called?" step, which just used its default); otherwise this falls
  // through to the interactive prompt, or a name-evidence-backed default in auto/--yes mode.
  async function askJoint(q) {
    if (ai) {
      const a = await ai(q);
      if (a != null) return a;
      if (!prompt && !rl) return SKIP;
    }
    if (prompt) {
      const a = await prompt(q, 0, 1);
      return a?.skip ? SKIP : a;
    }
    if (!rl) return { from: q.sources[0].value, inputs: q.suggestedInputs, fn: q.defaultName[q.sources[0].value] };
    console.log(`\n  ↳ ${q.text}`);
    q.sources.forEach((o, k) => console.log(`  ${k + 1}) ${o.label}`));
    let from = null;
    for (;;) {
      const line = await rl.question(`  where from [1-${q.sources.length}], s = skip for now: `);
      if (line.trim().toLowerCase() === "s") return SKIP;
      from = q.sources[Number(line) - 1]?.value;
      if (from) break;
    }
    let inputs = q.suggestedInputs;
    if (from === "fields") {
      q.itemFields.forEach((o, k) => console.log(`  ${k + 1}) ${o.label}${q.suggestedInputs.includes(o.value) ? "  (suggested by name)" : ""}`));
      const suggestedIdx = q.itemFields.map((o, k) => (q.suggestedInputs.includes(o.value) ? k + 1 : null)).filter((x) => x !== null);
      const line = await rl.question(`  which fields feed it, comma-separated [default: ${suggestedIdx.join(",") || "none"}], s = skip for now: `);
      if (line.trim().toLowerCase() === "s") return SKIP;
      inputs = line.trim() ? line.split(",").map((x) => q.itemFields[Number(x) - 1]?.value).filter(Boolean) : q.suggestedInputs;
    }
    const fnDefault = q.defaultName[from] ?? Object.values(q.defaultName)[0];
    const fnLine = (await rl.question(`  name for the placeholder [${fnDefault}], s = skip for now: `)).trim();
    if (fnLine.toLowerCase() === "s") return SKIP;
    return { from, inputs, fn: fnLine || fnDefault };
  }

  // Asks one question of any type and returns: an option (choice), an array of options (multi), a string (text),
  // or { from, inputs, fn } (joint, T12.4).
  async function ask(q, i, n) {
    if (q.type === "joint") return askJoint(q);
    // Follow-ups of a placeholder ("where does it come from?", "which fields?") are tiny tasks for the AI too.
    if (ai && q.sub) {
      const a = await ai(q);
      if (a != null) return a;
      if (!prompt && !rl) return SKIP;
    }
    if (prompt) {
      const a = await prompt(q, i, n);
      if (a?.skip) return SKIP;
      // LIN-190: "Save adapter & attach" answers a choice question directly with the mapping it just built and
      // saved, instead of an option index — same placeholder shape as "something else", just pre-built.
      if (a?.adapter && q.type === "choice") {
        const value = adapterAnswer(a.adapter);
        return { label: describeCustom(value), value };
      }
      if (q.type === "text") return String(a ?? "").trim() || q.default;
      if (q.type === "multi") return [].concat(a).map((k) => q.options[k]).filter(Boolean);
      return q.options[a];
    }
    if (!rl) return q.type === "text" ? q.default : q.type === "multi" ? [q.options[0]] : q.options[0];
    console.log(`\n${q.sub ? "  ↳ " : "? "}${q.text}`);
    if (!q.sub && q.note?.()) console.log(`  (${q.note()})`);
    q.options?.forEach((o, k) => console.log(`  ${k + 1}) ${o.label}`));
    if (q.type === "text") {
      const line = (await rl.question(`  name [${q.default}] (/skip to answer later): `)).trim();
      return line === "/skip" ? SKIP : line || q.default;
    }
    for (;;) {
      const line = await rl.question(q.type === "multi" ? `  answers, comma-separated [1-${q.options.length}], s = skip for now: ` : `  answer [1-${q.options.length}], s = skip for now: `);
      if (line.trim().toLowerCase() === "s") return SKIP;
      const picked = line.split(",").map((x) => q.options[Number(x) - 1]).filter(Boolean);
      if (q.type === "multi" ? picked.length : picked.length === 1 && !line.includes(",")) return q.type === "multi" ? picked : picked[0];
    }
  }

  for (const [i, q] of questions.entries()) {
    // An earlier answer may already have closed this one (see infer.mjs).
    if (q.isOpen && !q.isOpen()) continue;
    let choice = null;
    let source = "default";
    const prior = saved[q.id];
    if (prior?.custom && (q.validCustom?.(prior) ?? true)) {
      choice = { label: describeCustom(prior), value: prior };
      source = "saved";
    } else if (q.id in saved) {
      choice = q.options.find((o) => JSON.stringify(o.value) === JSON.stringify(prior));
      if (choice) source = "saved";
    }
    if (!choice && ai) {
      const a = await ai(q); // only answers with a cited fact; otherwise null and it falls through to you / stays open
      if (a) { choice = a; source = "ai"; }
    }
    if (!choice && auto) {
      choice = SKIP; // auto mode never asks: whatever saved answers don't cover stays open
    } else if (!choice && (prompt || rl)) {
      choice = await ask(q, i + 1, questions.length);
      source = "you";
    }
    if (!choice) choice = q.options[0];

    // Skipping (at any step) leaves the part as a TODO and is not saved, so it is asked again later.
    let skipped = choice === SKIP;
    if (!skipped && choice.custom?.joint) {
      // T12.4: one joint question, not three sequential ones (see customOption in this file).
      const jq = choice.custom.joint();
      const raw = await ask({ ...jq, id: `${q.id}#joint`, focusId: q.id, sub: true });
      if (raw === SKIP) skipped = true;
      else {
        const sourceOpt = jq.sources.find((s) => s.value === raw.from) ?? jq.sources[0];
        const inputOpts = (raw.inputs ?? []).map((v) => jq.itemFields.find((o) => o.value === v) ?? { label: `API field "${v}"`, value: v });
        const value = choice.custom.build({ from: sourceOpt, inputs: inputOpts, fn: raw.fn });
        choice = { label: describeCustom(value), value };
      }
    } else if (!skipped && choice.custom) {
      const acc = {};
      for (const step of choice.custom.steps) {
        const sq = step(acc);
        if (!sq) continue;
        acc[sq.key] = await ask({ ...sq, id: `${q.id}#${sq.key}`, focusId: q.id, sub: true });
        if (acc[sq.key] === SKIP) { skipped = true; break; }
      }
      if (!skipped) {
        const value = choice.custom.build(acc);
        choice = { label: describeCustom(value), value };
      }
    }
    if (skipped) {
      choice = { label: auto ? "left open (auto mode) — answer later" : "skipped for now — answer later", value: q.skipValue };
      source = "skipped";
    }

    q.apply(choice.value);
    if (!skipped) saved[q.id] = choice.value;
    log.push({ question: q.text, answer: choice.label, skipped });
    await onAnswer?.(q, choice, source);
  }
  rl?.close();
  return { answers: saved, log };
}
