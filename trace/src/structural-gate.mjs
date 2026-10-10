// The structural gate (behind --structural; off by default, and then nothing here runs).
//
// Runs right after matching. For every part the matcher would accept on its own (exactly one candidate):
//   1. src/structural.mjs asks whether the match is a structural coincidence (a count that is the row count, a
//      running number that is an id, an overall max, a small number from the envelope);
//   2. if a rule fires, src/evidence.mjs compares the design's own words for the part with the field's name:
//        supports                 -> the accept stands; the rule and the evidence are recorded (`part.structural`)
//        contradicts | neutral    -> the accept is NOT made: the part becomes a confirm-or-pick question
//                                    (src/questions/forms.mjs); in auto mode it stays open with the reason in the hint.
// Evidence never accepts anything by itself; it only decides how an already-flagged accept is handled.
// Parts no rule fires on are untouched, so a page with no flags generates exactly what it always did.
import { flatItems, envScalars, explainListField, explainValue } from "./match.mjs";
import { detectStructural } from "./structural.mjs";
import { evidence, describeEvidence } from "./evidence.mjs";
import { designLabels } from "./labels.mjs";

const ID_LIKE = /^(id|_id|uid|uuid|index|idx|key|pk)$/i;
// A page with no rendered list (count() over raw API items, e.g. a metrics dashboard) has no list name or column
// header to name "what a row is". Its own first string field is the closest stand-in ("region" for a list of
// regions), so evidence can still recognize `regionCount` as explained rather than asking about it needlessly.
const implicitSubject = (items) => {
  const first = items[0];
  if (!first) return "";
  return Object.keys(first).find((k) => typeof first[k] === "string" && !ID_LIKE.test(k)) ?? "";
};

const sig = (c) => `${c.agg ?? ""}(${c.field ?? ""})|${c.formatter}`;
// The other explanations that also reproduce the text (the matcher keeps only the cheapest), cheapest first.
const rank = (list, own) => list.filter((c) => sig(c) !== sig(own)).sort((a, b) => a.cost - b.cost || (sig(a) < sig(b) ? -1 : 1));
const brief = (e) => ({ verdict: e.verdict, score: e.score, matched: e.matched, unmatched: e.unmatched, label: e.label, candidate: e.candidate });

/**
 * What the gate needs besides the match: the design's words for each part and the contract's field docs.
 *
 * @param {string} pageSource The page source.
 * @param {object} spec The spec (readSpec output); `spec.contract.fieldDocs` is used when present.
 * @returns {{labels: object, docs: object}} The context for applyStructural.
 */
export const structuralContext = (pageSource, spec) => ({ labels: designLabels(pageSource), docs: spec?.contract?.fieldDocs ?? {} });

/**
 * Applies the gate to a matched screen (mutates it) and returns one row per flagged part.
 *
 * @param {object} matched The result of match().
 * @param {{labels?: {values: object, fields: object}, docs?: object}} [ctx] `labels` from designLabels(); `docs` the contract's field docs.
 * @returns {{part: string, pattern: string, decision: "accepted"|"asked", reason: string, evidence: object}[]} The flags, in screen order.
 */
export function applyStructural(matched, { labels = { values: {}, fields: {} }, docs = {} } = {}) {
  const items = flatItems(matched.endpoints);
  const env = envScalars(matched.endpoints);
  const subject = matched.list ? [matched.list?.name ?? "", labels.list?.header ?? ""].join(" ").trim() : implicitSubject(items); // what a row is
  const rows = [];

  const decide = (id, part, label, examples, alternativesOf) => {
    if (part.candidates.length !== 1) return;
    const candidate = part.candidates[0];
    const flag = detectStructural({
      candidate, examples, items, itemCount: items.length,
      values: candidate.field && !candidate.agg ? items.map((it) => it[candidate.field]) : [],
    });
    if (!flag) return;
    const ev = evidence({ label, candidate, docs, subject });
    if (ev.verdict === "supports") {
      part.structural = { decision: "accepted", pattern: flag.pattern, reason: flag.reason, evidence: brief(ev) };
    } else {
      part.structural = {
        decision: "asked", pattern: flag.pattern, reason: flag.reason, evidence: brief(ev),
        risk: `${flag.reason}; ${describeEvidence(ev)}`,
        alternatives: rank(alternativesOf(), candidate),
      };
    }
    rows.push({ part: id, pattern: flag.pattern, decision: part.structural.decision, reason: flag.reason, evidence: brief(ev) });
  };

  const idx = matched.list?.alignedIdx ?? [];
  const aligned = idx.map((i) => items[i]).filter(Boolean);
  for (const f of matched.list?.fields ?? []) {
    decide(`list.${f.name}`, f, labels.fields?.[f.name] ?? { name: f.name }, f.examples.map(String),
      () => f.candidates.all ?? (aligned.length === f.examples.length ? explainListField(f.name, f.examples.map((e) => ({ [f.name]: e })), aligned) : []));
  }
  for (const v of matched.values) {
    decide(`value.${v.name}`, v, labels.values?.[v.name] ?? { name: v.name }, [String(v.example)], () => v.candidates.all ?? explainValue(v.example, items, env));
  }
  return rows;
}

/** The flags of a matched screen after applyStructural(), for status.json and reports. */
export function structuralRows(matched) {
  const rows = [];
  for (const f of matched.list?.fields ?? []) if (f.structural) rows.push(rowOf(`list.${f.name}`, f.structural));
  for (const v of matched.values) if (v.structural) rows.push(rowOf(`value.${v.name}`, v.structural));
  return rows;
}
const rowOf = (part, s) => ({ part, pattern: s.pattern, decision: s.decision, reason: s.reason, evidence: s.evidence });
