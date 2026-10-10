// The scoped chat of the Part inspector. The model sees ONLY this part's facts (the question's context, the options with
// their proof, the API sample and the code slice) and may propose an option; it never applies anything. Three fixed
// rules stand around it, none of them a model's judgement:
//   1. a question that has nothing to do with this part is refused before any model is asked
//   2. the reply is checked: every number, quoted name and field name in it must appear in the facts (or the question)
//   3. a proposal ("PROPOSE: 2") is only an option number; the page selects it for preview and you press Apply
import { factsOf, checkDraft } from "../ai/mail-chat.mjs";
import { words } from "../ai/context.mjs";

export const REFUSAL = "I only know about this part.";

// The facts, as text the model reads and the checker compares against. Deterministic: options in their fixed order.
export function factsSheet(p) {
  const L = [];
  L.push(`PART: ${p.title} (${p.id})`);
  L.push(`STATE: ${p.termWord}${p.issue ? `, ${p.issue.label}: ${p.issue.words}` : ""}`);
  if (p.design?.length) L.push(`THE DESIGN SHOWS: ${p.design.map((d) => JSON.stringify(d)).join(", ")}`);
  if (p.endpoint) L.push(`API ENDPOINT: ${p.endpoint}`);
  if (p.why) L.push(`WHY IT IS OPEN: ${p.why.text}`);
  L.push("OPTIONS:");
  p.options.forEach((o, i) => {
    const pr = o.proof;
    const rows = (pr?.rows ?? []).slice(0, 4).map((r) => `${r.produced == null ? "nothing" : JSON.stringify(r.produced)} for ${JSON.stringify(r.design)}`).join(", ");
    L.push(`${i + 1}) ${o.label}${o.ruleDefault ? " [Rule default]" : ""}${o.current ? " [in use now]" : ""}${pr?.note ? `. ${pr.note}` : ""}${rows ? ` It produces ${rows}.` : ""}`);
    if (o.api) L.push(`   API: ${o.api.endpoint ?? ""} ${o.api.path}${o.api.sample ? `. Sample: ${o.api.sample.replace(/\s+/g, " ")}` : ""}`);
  });
  const s = p.code?.slices?.[0];
  if (s) L.push(`GENERATED CODE (${s.file}, lines ${s.start}-${s.end}):\n${s.code.split("\n").slice(0, 24).join("\n")}`);
  else L.push(p.code?.generated ? "GENERATED CODE: nothing for this part yet." : "GENERATED CODE: not generated yet.");
  return L.join("\n").slice(0, 6000);
}

// A question is about this part when it names something of the part (its name, a field, a value, an option), or points at it
// ("this", "the code", "the options") and asks what people ask of a part. Everything else is refused, without a model.
const INTENT = new Set("why open pick choose chose mean meant work works fix change apply recommend recommended best better wrong problem issue safe risk happen happens differ difference option options answer explain reproduce match matches gap tie stub fit code function field fields value values example examples proof sample response endpoint api design show shows shown text format data".split(" "));
const POINTS = /\b(this|these|those|that|here|it|the (code|options?|part|field|fields|value|values|proof|preview|stub|gap|tie|design|api|sample|answer))\b/i;
// Only the part's own words count, not the code's: "write a function" must not pass because the code slice has one.
export function scopeWords(p) {
  const head = [p.title, p.id, p.termWord, p.issue?.label, p.issue?.words, ...(p.design ?? []), p.endpoint, p.why?.text, ...p.options.map((o) => `${o.label} ${o.api?.path ?? ""} ${(o.proof?.rows ?? []).map((r) => `${r.design} ${r.produced ?? ""}`).join(" ")}`)];
  const own = new Set(words(head.filter(Boolean).join(" ")));
  for (const w of INTENT) own.delete(w); // generic words are handled by the pointing rule below
  for (const w of ["for", "not", "only", "same", "what", "which", "who", "how"]) own.delete(w);
  return own;
}
export function inScope(question, p) {
  const q = String(question ?? "").trim();
  if (!q || q.length > 600) return false;
  const ws = words(q);
  if (ws.some((w) => scopeWords(p).has(w))) return true;
  return POINTS.test(q) && ws.some((w) => INTENT.has(w));
}

export const SYSTEM = `You answer questions about ONE part of a screen, using only the FACTS below.
Use only names, numbers and words that appear in the FACTS. If the FACTS do not say, answer "The facts do not say."
If the question is not about this part, answer exactly: ${REFUSAL}
Reply in a few short sentences of plain words, no markdown. If you recommend one of the OPTIONS, end with a last line "PROPOSE: <option number>". You never change anything yourself.`;

export const systemFor = (sheet) => `${SYSTEM}\n\nFACTS\n${sheet}`;

// The last few turns, as the model sees them, then the new question.
export function chatMessages({ history = [], question }) {
  const past = history.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
  return [...past, { role: "user", content: String(question).slice(0, 600) }];
}

// "PROPOSE: 2" on its own line, as an option number within range (else null). The line is removed from the text shown.
export function parseReply(text, optionCount) {
  const t = String(text ?? "").replace(/^\s*```\w*\n?/, "").replace(/\n?```\s*$/, "").trim();
  const m = /^\s*PROPOSE:\s*(\d+)\s*$/im.exec(t);
  const n = m ? Number(m[1]) : null;
  return { text: t.replace(/^\s*PROPOSE:.*$/gim, "").trim(), proposed: n != null && n >= 1 && n <= optionCount ? n : null, proposedRaw: n };
}

// Everything that looks like a fact in the reply must be in the facts sheet or the question. Anything else is flagged.
export function checkReply({ sheet, question, reply, optionCount = 0 }) {
  const nums = Array.from({ length: optionCount }, (_, i) => `option ${i + 1}`).join(", "); // the options' own numbers are facts too
  const c = checkDraft({ from: `${sheet}\n${nums}\n${question}`, draft: reply });
  return { ok: c.invented.length === 0, flagged: c.invented };
}

export { factsOf };
