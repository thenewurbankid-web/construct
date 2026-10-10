// Draft ground truth from what a run recorded: the human answers in answers.json, the AI's in decisions.json,
// and what Trace settled by itself. It is a DRAFT: the shipped examples were reviewed by hand on top of it
// (see tools/snapshot-examples.mjs) and `eval:promote` marks whatever nobody confirmed as uncertain.
import { canonCandidate } from "./truth.mjs";

// parts: describeParts() of the baseline analysis with NO answers applied.
export function deriveTruth(parts, { answers = {}, decisions = {}, unconfirmed = false } = {}) {
  const out = {};
  for (const p of parts) {
    if (p.cls === "endpoint") continue;
    const a = answers[p.qid];
    const aiDecided = decisions[p.qid] != null;
    if (a !== undefined) {
      const want = canonCandidate(a);
      const kind = want.startsWith("gap:") ? "gap" : p.candidates.length > 1 ? "needs-answer" : "match";
      out[p.id] = { kind, want, derived: aiDecided ? "ai-answer" : "human-answer", label: aiDecided ? "self" : "independent" };
      if (aiDecided) out[p.id].uncertain = "the recorded answer was given by the AI (decisions.json) and nobody reviewed it";
    } else if (p.outcome === "accept") {
      out[p.id] = { kind: "match", want: p.accepted, derived: "trace-accepted", label: "self" };
      if (unconfirmed) out[p.id].uncertain = "derived from Trace's own output, not confirmed by a person";
    } else if (p.candidates.length === 0 && p.cls !== "action") {
      out[p.id] = { kind: "gap", want: "gap:todo", derived: "no-candidate", label: "self" };
      if (unconfirmed) out[p.id].uncertain = "no answer recorded; assumed a gap";
    } else {
      out[p.id] = { kind: p.cls === "action" ? "gap" : "needs-answer", want: p.default ?? "gap:todo", derived: "unanswered", label: "self" };
      out[p.id].uncertain = "asked but no answer was recorded";
    }
  }
  return out;
}
