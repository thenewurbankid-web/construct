// Plain-language explanations of open items for the run summary.
// The model only writes the words. Priority and severity are fixed by rule, and its text is accepted only if it
// stays inside the facts we gave it: no number, quoted value or name that isn't in the input, short, and about
// this part. Anything else falls back to a fixed template, so the summary reads well with no model at all.
import { words } from "./context.mjs";

// severity: how urgent, by rule (not by the model)
export const SEVERITY = {
  gap: { rank: 1, label: "Blocker" },
  missing: { rank: 1, label: "Blocker" },
  tie: { rank: 2, label: "Risk" },
  skipped: { rank: 3, label: "Decision" },
  placeholder: { rank: 4, label: "To write" },
};

export function plainTemplate(o) {
  const p = `"${o.part}"`;
  // the contract itself (missing, or without an example): one plain item, not a per-part story
  if (o.id?.startsWith("contract")) return { headline: o.why, why: "Until it is in place, the parts of the page that need the API stay open and the generated code is only stubs.", action: o.hint };
  const T = {
    tie: [`Two fields fit ${p} equally well`, "Your sample data can't tell them apart, so a wrong pick would still look right and pass the tests.", "Pick the right one, or change the sample data so only one fits."],
    skipped: [`${p} is waiting for an answer`, "It was skipped, so the generated code leaves a stand-in here.", "Answer it, or leave it if it can wait."],
    missing: [`${p} has nothing behind it in the API`, "The screen would show a stand-in value or a dead control.", o.hint],
    placeholder: [`${p} is a stub someone has to write`, "The page looks right today, but the logic behind it isn't real yet.", "Fill in the function named in the report."],
    gap: [`The design and the contract disagree about ${p}`, "One of them is out of date, and nothing will catch it until it ships.", o.hint],
  }[o.state] ?? [`${p} needs attention`, o.why, o.hint];
  return { headline: T[0], why: T[1], action: T[2] };
}

const LIMITS = { headline: 100, why: 190, action: 140 };
const numbers = (s) => s.match(/\d(?:[\d.,]*\d)?[%MKB]?/g) ?? []; // "3," at the end of a clause is the number 3
const quoted = (s) => [...s.matchAll(/"([^"]+)"|“([^”]+)”|(?:^|[\s(])'([^']{2,}?)'(?=[\s.,;:)]|$)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

// Claims about counts must match the facts. A word like "placeholder" or "blocker" may appear only if some fact
// line about it has a non-zero number, and "no blockers" only if the count really is zero.
const CLAIMS = [
  [/\bplaceholders?\b/gi, /placeholder|stub/i], [/\bblockers?\b/gi, /blocker/i], [/\bties\b|\btied\b|\btie\b/gi, /\btie/i],
  [/\bskipp(?:ed|ing)\b/gi, /skipp/i], [/\bmissing\b|\bnothing behind\b/gi, /missing|nothing behind/i], [/\bcach(?:e|ed)\b/gi, /cache/i],
  [/\bfail(?:ed|ures?)?\b|\berrors?\b/gi, /error|fail/i], [/\bnew files?\b/gi, /new files/i], [/\bmodified\b/gi, /modified/i],
];
export function checkClaims(text, facts) {
  const lines = facts.split("\n");
  for (const [term, factRe] of CLAIMS) {
    for (const m of text.matchAll(term)) {
      const about = lines.filter((l) => factRe.test(l));
      if (!about.length) return `it mentions "${m[0]}", which the facts do not talk about`;
      const total = about.reduce((n, l) => n + Math.max(0, ...(l.match(/\d+/g) ?? [1]).map(Number)), 0);
      const negated = /\b(?:no|zero|without|none|not any|nothing|neither)\s+(?:\w+\s+){0,2}$/i.test(text.slice(Math.max(0, m.index - 24), m.index));
      if (total === 0 && !negated) return `it mentions "${m[0]}" but the facts say there are none`;
      if (total > 0 && negated) return `it says there are no "${m[0]}" but the facts say there are ${total}`;
    }
  }
  return null;
}

// Returns { ok, why }. `facts` is everything the model was shown.
export function checkExplanation(e, facts, o) {
  if (!e || typeof e !== "object") return { ok: false, why: "the reply was not a JSON object" };
  for (const k of Object.keys(LIMITS)) {
    if (typeof e[k] !== "string" || !e[k].trim()) return { ok: false, why: `"${k}" is missing` };
    if (e[k].length > LIMITS[k]) return { ok: false, why: `"${k}" is longer than ${LIMITS[k]} characters` };
  }
  const out = `${e.headline} ${e.why} ${e.action}`;
  const bad = numbers(out).find((n) => !facts.includes(n)) ?? quoted(out).find((q) => !facts.includes(q));
  if (bad) return { ok: false, why: `it mentions "${bad}", which is not in the facts it was given` };
  const claim = checkClaims(out, facts);
  if (claim) return { ok: false, why: claim };
  const known = new Set([...words(o.part), ...words(o.why)]);
  if (!words(e.headline).some((w) => known.has(w))) return { ok: false, why: "the headline is not about this part" };
  return { ok: true };
}

export const EXPLAIN_SYSTEM = "You explain one open item of a software build to a product manager, in plain words. Use ONLY the facts given: never add numbers, names or quotes that are not in them. Reply with JSON only.";
export const explainPrompt = (o, facts) => `${facts}\nWrite three short plain-language lines for a product manager:\n- headline: what the matter is (max ${LIMITS.headline} characters, mention "${o.part}")\n- why: why it matters to the people using the screen (max ${LIMITS.why} characters)\n- action: the next step (max ${LIMITS.action} characters)\nReply: {"headline": "...", "why": "...", "action": "..."}`;
export const EXPLAIN_SCHEMA = { type: "object", properties: { headline: { type: "string" }, why: { type: "string" }, action: { type: "string" } }, required: ["headline", "why", "action"] };

// ---- run summary blocks: one short paragraph per section, each seen with only its own facts ----
export const BLOCK_SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
export const blockPrompt = (b) => `Section: ${b.title}\nFacts:\n${b.facts}\nWrite one or two plain sentences (max 200 characters) about this section for a product manager. Lead with anything that needs attention. Use only these facts.\nReply: {"summary": "..."}`;
export function checkBlock(e, b) {
  if (!e || typeof e.summary !== "string" || !e.summary.trim()) return { ok: false, why: "no summary in the reply" };
  if (e.summary.length > 220) return { ok: false, why: "longer than 220 characters" };
  const bad = numbers(e.summary).find((n) => !b.facts.includes(n)) ?? quoted(e.summary).find((q) => !b.facts.includes(q));
  if (bad) return { ok: false, why: `it mentions "${bad}", which is not in this section's facts` };
  const claim = checkClaims(e.summary, b.facts);
  return claim ? { ok: false, why: claim } : { ok: true };
}
