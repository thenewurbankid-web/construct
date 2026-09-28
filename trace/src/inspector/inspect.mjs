// Everything the Part inspector shows about one part, and the checks that turn a click into a valid answer.
// Pure functions of the example's files (state.mjs) plus the generated files a run wrote (code.mjs): no model here.
import { questionContext } from "../question-context.mjs";
import { teamFor } from "../actions.mjs";
import { ISSUES, underlying } from "../ui/issues.mjs";
import { humanize, TERMS } from "../ui/vocab.mjs";
import { computeState, partOf } from "./state.mjs";
import { buildForm, scopeOf, proofOf, apiSourceOf, buildStubValue, runExpression } from "./options.mjs";
import { codeFor } from "./code.mjs";
import { summary } from "./history.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The part's name for people: "Maturity", "The delete button", "Row order".
export function titleOf(part) {
  const id = part.id;
  if (id === "list.sort") return "Row order";
  if (id.startsWith("action.")) return `The ${id.split(".").slice(2).join(".")} button`;
  if (id.startsWith("form.missing.")) return `The ${id.slice(13)} input`;
  if (id.startsWith("form.")) return `The ${id.slice(5)} input`;
  if (id.startsWith("gap.")) return "A gap on the page";
  return humanize(id.split(".").slice(1).join("."));
}

export async function inspectPart({ dir, outRoot, id, state = null }) {
  const st = state ?? (await computeState(dir));
  const part = partOf(st, id), sc = scopeOf(st, id);
  if (!part || !sc) return null;
  const form = buildForm(st, id);
  const ctx = questionContext({ id }, st.fresh, st.spec);
  const kind = part.kind ? underlying(part.kind, part.item) : null;

  const options = form.options.map((o) => {
    const value = o.stub ? (o.current && form.current?.custom ? form.current : { custom: true, from: o.stub.from, inputs: [], fn: o.stub.fn }) : o.value;
    return { ...o, proof: proofOf(st, sc, value), api: apiSourceOf(st, sc, value), value: o.stub ? o.current ? form.current : null : o.value };
  });
  const current = options.find((o) => o.current) ?? null;
  const customFn = form.current?.custom ? form.current.fn : null;
  const focusName = sc.scope === "row" ? sc.name : null;
  const code = codeFor(st, id, outRoot, { customFn, focusName });
  const item = part.item;
  return {
    id, title: titleOf(part), label: part.label, scope: sc.scope,
    term: part.term, termWord: TERMS[part.term].word, kind, badge: part.kind,
    issue: part.kind ? { kind: part.kind, ...pick(ISSUES[part.kind]) } : null,
    why: item ? { text: item.why, hint: item.hint, team: teamFor(item) } : null,
    design: ctx.design, endpoint: ctx.endpoint,
    form: { id: form.form, title: form.title, applicable: form.applicable, builder: !!form.builder },
    options, currentId: current?.id ?? null,
    code, history: summary(dir, id).part,
    stats: st.stats,
  };
}
const pick = ({ label, words, color, explain, icon, team }) => ({ label, words, color, explain, icon, team });

// A click (a choice made in the form) as the answer it stands for, or an error in plain words. Nothing is written here.
//   choice: { option, inputs?, fn?, expression?, keepUnverified? }
export function resolveChoice(st, id, choice) {
  const form = buildForm(st, id), sc = scopeOf(st, id);
  if (!form || !form.applicable) return { error: "This part is closed in the design or the contract, not by an answer here." };
  const opt = form.options.find((o) => o.id === choice?.option);
  if (!opt) return { error: "That option is not one of this part's choices." };
  if (!opt.stub) return { value: opt.value, option: opt };
  const built = buildStubValue(st, id, form, choice);
  if (built.error) return { error: built.error };
  const value = built.value;
  const expr = String(choice.expression ?? "").trim();
  let check = null;
  if (expr) {
    if (value.from !== "fields") return { error: "Only a Stub built from fields can carry an expression." };
    const r = runExpression(st, sc, expr);
    const bad = r.rows.find((x) => x.error);
    if (bad) return { error: `That expression can't be used: ${bad.error}. Use item.<field>, text and simple methods like join or toUpperCase.` };
    check = { rows: r.rows, verified: r.verified };
    if (!r.verified && !choice.keepUnverified) return { error: "The expression does not reproduce the design's examples. Fix it, or keep it as unverified.", unverified: true, rows: r.rows };
    value.body = expr;
    value.by = "you";
    if (!r.verified) value.unverified = true;
  }
  return { value, option: opt, check };
}

// Other parts with the same kind of trouble and the same candidates, to which the same choice could be applied.
export function similarParts(st, id, choice) {
  const part = partOf(st, id), base = buildForm(st, id);
  const opt = base?.options.find((o) => o.id === choice?.option);
  if (!part?.kind || !opt || opt.stub || opt.group === "static") return [];
  const kind = underlying(part.kind, part.item);
  const candKey = (f) => JSON.stringify(f.options.filter((o) => o.group === "candidates").map((o) => o.value));
  const out = [];
  for (const p of st.parts) {
    if (p.id === id || !p.kind || underlying(p.kind, p.item) !== kind) continue;
    const f = buildForm(st, p.id);
    if (!f || f.form !== base.form || f.scope !== base.scope || candKey(f) !== candKey(base)) continue;
    const match = f.options.find((o) => !o.stub && same(o.value, opt.value));
    if (!match || match.current) continue;
    out.push({ id: p.id, title: titleOf(p), option: match.id, label: match.label });
  }
  return out;
}

export { computeState };
