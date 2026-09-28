// The email composer's chat. The model may propose a new version of an email; it never applies one.
// Every draft is compared with the email it was made from, and any detail that was not in that email or in the
// request (a field name, endpoint, number, date) is listed as "invented" and stops the draft being applied
// automatically. The reply is plain text (NOTE / SUBJECT / BODY) so it can be shown while it streams.

// Two modes, chosen by a fixed rule (not by the model), because a small model can do one plain job at a time:
//   edit  rewrite the email as asked and reply with the new email only
//   ask   answer a question about the email in a few sentences; nothing is proposed
const QUESTION = /\?\s*$|^\s*(?:why|what|which|who|how|when|where|can you explain|explain)\b/i;
export const modeOf = (instruction) => (QUESTION.test(instruction) ? "ask" : "edit");

export const SYSTEM = {
  edit: `You rewrite one work email as the user asks.
Keep every item, field name, endpoint and number exactly as written, unless told to drop items. Do not add facts, names, dates or numbers that are not in the email or the request. Plain text, no markdown.
Reply with the new email only: the first line is "Subject: <subject>", then a blank line, then the body.`,
  ask: `You answer a question about one work email, in one to three short sentences. Use only what the email says. If it does not say, answer "The email does not say."`,
};

export const QUICK = [
  ["Shorter", "Make it shorter: one line per item, keep every item."],
  ["Friendlier", "Make the tone friendlier and warmer, same content."],
  ["More formal", "Make the tone more formal and professional, same content."],
  ["Only blockers", "Keep only the items that block progress and drop the rest."],
  ["Add a deadline", "Ask for a reply by the end of the week."],
  ["Bullets", "Rewrite each item as short bullet points."],
];

// What the model sees: the current text (which may have been edited by hand) and the instruction, plus at most the
// last few earlier instructions, not the earlier drafts, so the prompt stays small.
export function mailMessages({ subject, body, instruction, earlier = [] }) {
  const past = earlier.slice(-3).map((t, i) => `${i + 1}. ${t}`).join("\n");
  const mode = modeOf(instruction);
  return [{ role: "user", content: `CURRENT EMAIL\nSubject: ${subject}\n\n${body}\n\n---\n${past && mode === "edit" ? `Earlier requests, already applied:\n${past}\n` : ""}${mode === "edit" ? "REQUEST" : "QUESTION"}: ${instruction}\n${mode === "edit" ? "Reply with the full new email (Subject line, blank line, body)." : ""}` }];
}

// edit: the reply is the new email. Anything before its "Subject:" line ("Sure! Here is…") is dropped; a reply with no
// Subject line keeps the current subject. ask: the whole reply is the answer.
export function parseReply(text, mode = "edit") {
  const t = String(text ?? "").replace(/^\s*```\w*\n?/, "").replace(/\n?```\s*$/, "").trim();
  if (mode === "ask") return { note: t, subject: null, body: null };
  const at = t.search(/^Subject:/im);
  const rest = at >= 0 ? t.slice(at) : t;
  const subject = at >= 0 ? rest.match(/^Subject:[ \t]*(.*)$/im)?.[1]?.trim() || null : null;
  const body = (at >= 0 ? rest.replace(/^Subject:.*\n?/i, "") : rest).replace(/^BODY:[ \t]*\n?/i, "").replace(/^\s*\n/, "").replace(/\s+$/, "");
  return { note: "", subject, body: body || null };
}

// Small models sometimes loop ("---" a hundred times). Repeated separator lines collapse to one, and a trailing
// separator or blank run is cut, so the proposal that is shown is the email and not the loop.
export function tidy(body) {
  const out = [];
  for (const l of String(body).split("\n")) {
    const sep = /^[\s\-_=*#~.]{3,}$/.test(l);
    if (sep && out.length && out[out.length - 1].trim() === l.trim()) continue;
    if (!l.trim() && out.length && !out[out.length - 1].trim()) continue;
    out.push(l);
  }
  while (out.length && (!out[out.length - 1].trim() || /^[\s\-_=*#~.]{3,}$/.test(out[out.length - 1]))) out.pop();
  return out.join("\n");
}

// Things a reader would treat as facts: quoted names, dotted or slashed names, camelCase and snake_case names,
// ticket ids, endpoints, numbers, weekdays and months.
const FACT = /"[^"\n]{2,}"|\b[A-Z][A-Z0-9]+-\d+\b|\b[\w-]+(?:[./][\w-]+)+\b|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\b(?:GET|POST|PUT|PATCH|DELETE)\b|\b\d[\d.,]*%?/g;
const DATES = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/gi; // "may" is left out: it is also a verb
// list numbers ("1. ", "2) ") are layout, not facts: turning a numbered list into bullets must not count as losing details
export const factsOf = (s0) => { const s = String(s0).replace(/^[ \t]*\d{1,2}[.)][ \t]/gm, ""); return new Set([...(s.match(FACT) ?? []), ...(s.match(DATES) ?? [])].map((x) => x.toLowerCase().replace(/[.,]+$/, "")).filter((x) => x && x !== "e.g" && x !== "i.e")); };

// `from` is what the model was shown (the current email and the instructions). Returns which facts the draft
// added (invented), and which it left out (dropped, which is fine if that was asked for).
export function checkDraft({ from, draft, baseLines = 0 }) {
  const base = factsOf(from), got = factsOf(draft);
  const invented = [...got].filter((f) => !base.has(f));
  const dropped = [...base].filter((f) => !got.has(f));
  // "lossy": most of the original's details are gone. Fine if that was the request (only blockers), but not something to apply unseen.
  const lossy = base.size >= 4 && dropped.length / base.size > 0.5;
  const bloated = draft.split("\n").length > Math.max(30, baseLines * 2.5); // far longer than what it was made from: probably a loop
  return { ok: invented.length === 0 && draft.trim().length >= 30, lossy, bloated, invented, dropped, kept: [...got].length - invented.length, total: base.size };
}
