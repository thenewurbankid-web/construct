// The question-form registry: every KIND of multiple-choice question Trace asks, in one place.
//
// A form has a stable id, a type (choice | multi | text, as src/ask.mjs answers them), a plain-language template
// (text(ctx)) and an ordered-options function (options(ctx)). src/ask.mjs builds its questions from these, so later
// work adds or reuses a form here instead of writing question text inline. Pure: no I/O, nothing random.
// The wording of the older forms is exactly what ask.mjs always produced (the generated REPORT.md quotes it), so do
// not reword them without a deliberate golden-hash update (src/fixtures/pre-migration-output.json).
//
// ctx (what a form needs), by form:
//   part forms   { scope: "row"|"value", name, example, candidates, describe, blockWhy?, alternatives?, risk?, samples? }
//   pick-sort    { name, sorts }            action-kind { name, scope, kind, missing, possible, labels }
//   placeholder  { part, sources | fields | fallback }
//
// Option order rule for a part form: the candidates first (the matcher's own answers, ranked), then the
// "no data" answer when there is nothing to pick, then static text, then "something else" (added by ask.mjs).

const subject = (c) => (c.scope === "row" ? `Row part "${c.name}" (e.g. "${c.example}")` : `"${c.name}" (shows "${c.example}")`);
const asOption = (c, describe) => ({ label: describe(c), value: c });
const TODO = { label: "data the API doesn't provide yet — leave a TODO", value: { todo: true } };
const STATIC = { label: "static text — not data", value: { static: true } };

export const FORMS = {
  // Exactly one candidate reproduces the text, but a structural rule (src/structural.mjs) says it may be a
  // coincidence and the design's words do not vouch for it (src/evidence.mjs). A) confirm it, B) pick one of the
  // other explanations that also fit (ranked), C) leave a gap.
  "confirm-or-pick": {
    id: "confirm-or-pick",
    type: "choice",
    describe: "One explanation fits, but it could be a coincidence: confirm it, pick another, or leave a gap.",
    text: (c) => `${subject(c)} matched ${c.describe(c.candidates[0])}, but that could be a coincidence: ${c.risk}. The design shows ${c.samples}. Confirm it, pick another explanation, or leave it as a gap?`,
    options: (c) => [
      { label: `Confirm: ${c.describe(c.candidates[0])}`, value: c.candidates[0] },
      ...(c.alternatives ?? []).map((a) => ({ label: `Pick instead: ${c.describe(a)}`, value: a })),
      { label: "Leave it as a gap — a TODO to answer later", value: { todo: true } },
    ],
  },
  // More than one lowest-cost explanation: the data cannot tell them apart.
  "pick-one": {
    id: "pick-one",
    type: "choice",
    describe: "Several explanations fit equally well: which one is meant?",
    text: (c) => c.scope === "row"
      ? `${subject(c)} matches more than one API field, and the mock data can't tell them apart. Which one is meant?`
      : `${subject(c)} can be computed more than one way from the mock data. Which is meant?`,
    options: (c) => c.candidates.map((x) => asOption(x, c.describe)),
  },
  // Exactly one candidate, asked only because the user passed --ask-all.
  "keep-or-change": {
    id: "keep-or-change",
    type: "choice",
    describe: "One explanation fits: keep it or choose something else (--ask-all).",
    text: (c) => `${subject(c)} matched ${c.describe(c.candidates[0])}. Keep that, or choose something else?`,
    options: (c) => c.candidates.map((x) => asOption(x, c.describe)),
  },
  // Nothing reproduces the text.
  "no-source": {
    id: "no-source",
    type: "choice",
    describe: "Nothing in the data produces the text: what is it?",
    text: (c) => (c.scope === "row"
      ? `${subject(c)} can't be produced from any API field.${c.blockWhy ? " " + c.blockWhy : ""} What is it?`
      : `${subject(c)} can't be computed from the mock data.${c.blockWhy ? " " + c.blockWhy : ""} What is it?`),
    options: () => [TODO],
  },
  "pick-sort": {
    id: "pick-sort",
    type: "choice",
    describe: "The designed row order fits more than one sort.",
    text: (c) => `The designed row order matches more than one sort on the mock data. How should "${c.name}" be sorted?`,
    options: (c) => (c.sorts.length ? c.sorts : [{ field: null, dir: "none", label: "keep the API order" }]).map((s) => ({ label: s.label, value: s })),
  },
  "action-kind": {
    id: "action-kind",
    type: "choice",
    describe: "What should this button do?",
    text: (c) => c.kind && c.missing.length
      ? `"${c.name}" looks like "${c.kind}", but the API for it (${c.missing.join(", ")}) wasn't given. What should it do?`
      : c.kind ? `"${c.name}" looks like "${c.kind}". Keep that, or choose something else?`
      : `What should the "${c.name}" ${c.scope === "row" ? "row " : ""}action do?`,
    // the guessed kind first, then the kinds the given endpoints allow
    options: (c) => {
      const possible = [...c.possible];
      if (c.kind && possible.includes(c.kind)) possible.unshift(...possible.splice(possible.indexOf(c.kind), 1));
      return possible.map((k) => ({ label: c.labels[k], value: k }));
    },
  },
  // The "something else" chain: where does it come from, which fields, what is the function called.
  "placeholder-source": { id: "placeholder-source", type: "choice", describe: "Where does a placeholder get its value?", text: (c) => `Where does "${c.part}" come from?`, options: (c) => c.sources },
  "placeholder-fields": { id: "placeholder-fields", type: "multi", describe: "Which API fields feed the placeholder?", text: (c) => `Which API fields feed "${c.part}"? Pick every one the placeholder should receive.`, options: (c) => c.fields.map((f) => ({ label: `API field "${f}"`, value: f })) },
  "placeholder-name": { id: "placeholder-name", type: "text", describe: "What is the placeholder function called?", text: (c) => `What should the placeholder function for "${c.part}" be called?`, options: () => undefined },
  "handler-name": { id: "handler-name", type: "text", describe: "What is the placeholder handler called?", text: (c) => `What should the placeholder handler for "${c.name}" be called?`, options: () => undefined },
};

export const formIds = () => Object.keys(FORMS);
export const formText = (id, ctx) => FORMS[id].text(ctx);
export const formOptions = (id, ctx) => FORMS[id].options(ctx);

// Which part form applies. `flagged` is only ever true when the structural gate (--structural) is on and asked about this part.
export function partFormId({ candidates, all = false, flagged = false }) {
  if (candidates.length > 1) return "pick-one";
  if (candidates.length === 0) return "no-source";
  if (flagged) return "confirm-or-pick"; // it carries the reason, so it wins over --ask-all's plain "keep or change"
  return all ? "keep-or-change" : null; // null: nothing to ask
}

// The tail every part question shares (static text; "something else" is added by ask.mjs).
export const withTail = (head) => [...head, STATIC];
export { STATIC as STATIC_OPTION };
