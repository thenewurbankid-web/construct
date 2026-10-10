// Suggest for one part: the same small, checked AI call a run makes for an Ask (src/ai/index.mjs), asked for this part
// only. It can only pick one of the options the rules computed, or draft a Stub expression that the same restricted
// evaluator then runs against the design's examples. It writes nothing (no cache, no decisions.json): applying stays a
// click, and the click is what records the choice. Everything the model says is checked before it is shown.
import { createAi } from "../ai/index.mjs";
import { resolveQuestions } from "../ask.mjs";
import { computeState } from "./state.mjs";
import { buildForm, scopeOf, runExpression } from "./options.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The verdicts of src/ai/index.mjs in plain words, keyed by what they say.
const REASONS = [
  [/no fact mentions/, "Nothing in the stories or the API notes is about this part, so Suggest has nothing to go on."],
  [/cited no fact|out of range/, "Suggest could not point to a fact that settles it."],
  [/does not mention the part/, "The fact Suggest pointed to is not about this part."],
  [/not valid JSON/, "Suggest's reply could not be read."],
  [/not one of the options/, "Suggest chose something that is not one of the options."],
  [/static text/, "Suggest may not choose fixed text. That stays your call."],
];
const plainReason = (text) => REASONS.find(([re]) => re.test(text ?? ""))?.[1] ?? "Suggest could not settle this one.";

export async function suggestFor({ dir, id, provider = null, overrides = {}, onLog = null }) {
  const st = await computeState(dir);   // for the AI: its question objects are consumed and mutated
  const view = await computeState(dir); // for the answer: the options as the inspector shows them
  const q = st.qAll.find((x) => x.id === id);
  const sc = scopeOf(view, id), form = buildForm(view, id);
  if (!q || !sc || !form?.applicable) return { ok: false, abstain: true, reason: "Suggest only answers parts that have a question. This one is closed in the design or the contract." };

  const logs = [];
  const ai = createAi({ dir, spec: st.spec, source: st.source, matched: st.fresh, overrides, provider, onLog: (e) => { logs.push(e); onLog?.(e); } });
  const { answers } = await resolveQuestions([q], { answers: {}, auto: true, ai: (qq) => ai.answer(qq) });
  const value = answers[id];
  const last = [...logs].reverse().find((l) => l.verdict || l.text);

  if (ai.stats.errors.length) return { ok: false, unreachable: true, reason: "Suggest can't reach its helper right now, so you choose yourself. Everything else works the same." };
  if (value === undefined) return { ok: false, abstain: true, reason: plainReason(last?.verdict?.text ?? last?.text) };

  // which of the inspector's options that value is
  let opt, choice;
  if (value?.custom) {
    opt = form.options.find((o) => o.stub?.from === value.from);
    choice = { option: opt?.id, inputs: value.inputs ?? [], fn: value.fn };
    if (opt?.stub?.expression) {
      await ai.draft(); // an expression for a Stub built from fields, kept only if it reproduces the design's examples
      const c = st.fresh.list?.fields.find((f) => `list.${f.name}` === id)?.candidates[0] ?? st.fresh.values.find((v) => `value.${v.name}` === id)?.candidates[0];
      if (c?.body) choice.expression = c.body;
    }
  } else {
    opt = form.options.find((o) => (o.stub ? false : same(o.value, value)));
    choice = { option: opt?.id };
  }
  if (!opt) return { ok: false, abstain: true, reason: "Suggest chose something that is not one of the options." };
  const d = ai.decisions[id];
  const expression = choice.expression ? { code: choice.expression, verified: runExpression(view, sc, choice.expression).verified } : null;
  return { ok: true, option: opt.id, choice, label: opt.label, fact: d?.evidence ?? null, model: d?.model ?? null, expression, cached: ai.stats.calls === 0 && ai.stats.cached > 0 };
}

