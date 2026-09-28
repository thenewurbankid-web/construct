#!/usr/bin/env node
// Builds eval/cases/example-*: a frozen copy of each shipped example's inputs plus REVIEWED ground truth.
// Re-running rewrites the same files (idempotent). It never writes into examples/.
//
// How the truth was made. Parts Trace settles by itself are labelled "self": the truth IS Trace's own answer, so they
// measure regression only (a document such as the contract's docs or a story can promote one to "independent", see
// DOC). Every part Trace
// asks about has an explicit entry below, taken from benchmarks/gold.json (written by a person from each story.md),
// the example's README/story, or a judgment noted in `why`. The recorded answers.json files were NOT used as truth
// where decisions.json shows the small model wrote them: several are plainly wrong (invoices "Requested by" as a
// controller placeholder although story.md says it is the requester).
//
//   M(want)             the data settles it: Trace should accept `want`
//   N(want)             a tie: Trace should ask, the right answer is `want`
//   G(resolution)       no API source: 'todo' | 'custom' | 'static' | '?' (a gap; how it gets closed was never recorded)
//   U(reason)           uncertain: excluded from every headline number
import fs from "node:fs";
import path from "node:path";
import { extract } from "../../src/extract.mjs";
import { baselineAnalyze } from "../variants.mjs";
import { describeParts } from "../truth.mjs";
import { readContract } from "../adapter.mjs";
import { ROOT, writeJson, hashOf } from "../util.mjs";

// Every hand-written entry below is INDEPENDENT truth: it comes from gold.json, a story, the contract's own docs or
// a judgment about the design, not from what Trace matched. Parts Trace settled by itself and nobody else vouched
// for are labelled "self" (circular: they can show a regression, never accuracy) further down.
const IND = { label: "independent" };
const M = (want, o = {}) => ({ kind: "match", want, ...IND, ...o });
const N = (want, o = {}) => ({ kind: "needs-answer", want, ...IND, ...o });
const G = (res, o = {}) =>
  res === "?" ? { kind: "gap", want: "gap:todo", also: ["gap:custom", "gap:static"], resolutionUnknown: true, ...IND, ...o } : { kind: "gap", want: `gap:${res}`, ...IND, ...o };
const U = (why) => ({ uncertain: why, ...IND });

// Parts Trace settles by itself that a document OTHER than Trace's output vouches for: the sentence is the basis.
const DOC = {
  "portfolio-figma-1": {
    "value.headline": 'story.md: "The narrative comes from the cross-category summary of the portfolio response." (cross_l2_summary)',
    "value.spendYouManage": 'contract docs: "spend_you_manage: Total spend across the categories the user manages." (design label: Spend you manage)',
    "list.share": 'contract docs: "spend.pct_of_total: The category\'s share of the user\'s total spend, 0 to 1." (design: the share beside spend)',
    "value.savingsCount": 'contract docs: "waiting_on_decision.savings_count: Savings initiatives waiting on a decision." (design label: Number of savings initiatives)',
  },
  "portfolio-redesigned": {
    "value.headline": 'story.md: "The narrative comes from the cross-category summary of the portfolio response."',
    "value.savingsCount": 'contract docs: "waiting_on_decision.savings_count: Savings initiatives waiting on a decision." (design label: Savings initiatives)',
  },
};
DOC["portfolio-figma-2"] = DOC["portfolio-figma-1"];
const MISMATCH = "design and contract disagree (scale, badge tokens or example values); the right resolution is a design decision";

const portfolioCommon = (extra = {}) => ({
  "list.rank": G("?", { why: "position in the table; no API field" }),
  "list.spend": N("f:spend.value|moneyCompact", { coincidence: true, why: "spend.value and spend_trend.curr_value hold the same numbers; the column is the category spend" }),
  "list.level": U(MISMATCH),
  "list.maturity": U(MISMATCH),
  "list.maturityGap": U(MISMATCH),
  "list.peer": U(MISMATCH),
  "list.savingsPct": G("?", { why: "savings_potential over spend, computed" }),
  "list.flagFirst": G("?", { why: "free text, not in the contract" }),
  "list.flagSecond": G("?", { why: "free text, not in the contract" }),
  "list.sort": U("the design's row order differs from the story's 'sorted by spend descending'; what to answer is a design decision"),
  "value.categoryCount": N("a:count()|asText", { coincidence: true, why: "the number of categories; waiting_on_decision.resilience_count is also 6 by chance" }),
  "value.improving": G("?", { why: "narrative text; only cross_l2_summary is in the contract" }),
  "value.declining": G("?", { why: "narrative text; only cross_l2_summary is in the contract" }),
  "value.spendCard": M("u:portfolio_at_a_glance.spend_you_manage|roundedMillions", { why: "$280M is spend_you_manage (280200000) rounded to whole millions; not a library formatter" }),
  "value.spendYoy": G("?", { why: "no year-on-year figure in the contract" }),
  "value.acceptedCount": G("?", { why: "'23 of 60' is not in the contract" }),
  "value.highCategories": G("?", { why: "a count of categories with a high flag; not in the contract" }),
  "value.savingsTarget": G("?", { why: "target; not in the contract" }),
  "value.oldestDays": G("?", { why: "age of the oldest waiting initiative; not in the contract" }),
  "value.riskCount": U("6 could be resilience_count or the number of categories; the label ('resilience initiatives') does not settle which"),
  "value.riskCategories": G("?", { why: "not in the contract" }),
  "value.riskTarget": G("?", { why: "target; not in the contract" }),
  "action.page.suggest": G("custom", { why: "story.md: suggestions are AI prompts that use a handler of our own" }),
  "action.page.suggest#2": G("custom", { why: "story.md: suggestions are AI prompts that use a handler of our own" }),
  ...extra,
});

const OVERRIDES = {
  categories: { "value.refreshedAt": G("todo", { why: "recorded human answer: the API has no refresh time" }) },
  contacts: {
    "list.fullName": G("custom", { why: "gold.json: first and last name combined" }),
    "list.initials": G("custom", { why: "gold.json / story.md: first letters of first and last name" }),
    "value.directoryUpdated": G("custom", { why: "gold.json: backend endpoint comes later" }),
    "action.row.call": G("custom", { why: "story.md: a handler of our own" }),
  },
  deals: {
    "list.contact": G("custom", { why: "gold.json: contactFirst + contactLast" }),
    "list.owner": N("f:owner|asText", { coincidence: true, couple: "owner-csm", why: "gold.json: owner and csm are identical in every row" }),
    "list.csm": N("f:csm|asText", { coincidence: true, couple: "owner-csm", why: "gold.json" }),
    "list.stage": G("todo", { why: "gold.json: not in the API" }),
    "value.weighted": G("custom", { why: "gold.json: sum of value x margin is not an aggregate" }),
    "value.syncedAt": G("custom", { why: "gold.json: controller supplies it" }),
    "action.row.forecast": G("custom", { why: "README: unknown verb, a handler of our own" }),
    "action.row.delete": U("README: it needs a DELETE endpoint the API lacks; the fix is an API change, not an answer"),
  },
  invoices: {
    "list.requestedBy": N("f:requester|asText", { coincidence: true, why: "story.md: the person who requested it; requester and assignee are identical in the sample" }),
    "list.status": G("todo", { why: "gold.json: data the API doesn't provide yet" }),
    "list.sort": N("s:amount:desc", { why: "story.md: largest amount first; outstanding and dueDate orders also fit" }),
    "value.largestInvoice": N("a:max(amount)|moneyCompact", { coincidence: true, why: "story.md: the largest invoice amount; max(outstanding) gives the same number" }),
    "value.syncedAt": G("custom", { why: "story.md: the controller supplies it" }),
    "action.row.archive": G("custom", { why: "story.md: a handler of our own" }),
  },
  metrics: { "value.asOf": G("?", { why: "README: add a field, or a controller placeholder or a new endpoint" }) },
  orders: {
    "list.status": G("?", { why: "README: no field behind it; how it gets closed depends on the API team" }),
    "action.row.delete": U("README: needs a DELETE endpoint the API lacks; the fix is an API change"),
    "action.page.save": U("README: needs a PUT endpoint the API lacks; the fix is an API change"),
  },
  products: {},
  roster: {
    "list.owner": N("f:lead|asText", { coincidence: true, couple: "owner-backup", why: "gold.json: lead and deputy are identical in every row" }),
    "list.backup": N("f:deputy|asText", { coincidence: true, couple: "owner-backup", why: "gold.json" }),
    "value.plannedTotal": N("a:sum(budget)|moneyCompact", { coincidence: true, couple: "totals", why: "gold.json: budget and forecast are identical in the sample" }),
    "value.forecastTotal": N("a:sum(forecast)|moneyCompact", { coincidence: true, couple: "totals", why: "gold.json" }),
  },
  "portfolio-figma-1": portfolioCommon(),
  "portfolio-figma-2": portfolioCommon(),
  "portfolio-redesigned": {
    "list.rank": G("?", { why: "position in the table" }),
    "list.level": U(MISMATCH),
    "list.shareLabel": U("the design shows 37% for Logistics, the contract says 13.7%: " + MISMATCH),
    "list.oppLabel": G("?", { why: "a sentence built from counts not in the contract" }),
    "list.acceptedLabel": G("?", { why: "a sentence built from counts not in the contract" }),
    "list.spend": U("the design example ($78.4M) differs from the contract's spend for that row ($38.4M): " + MISMATCH),
    "list.maturity": U(MISMATCH),
    "list.peer": U(MISMATCH),
    "list.savingsRangeRow": G("?", { why: "a low-high range; not in the contract" }),
    "list.spendChange": G("?", { why: "curr_value minus prev_value, computed" }),
    "list.sort": U("row order is a design decision here"),
    "value.improving": G("?", { why: "narrative text" }),
    "value.declining": G("?", { why: "narrative text" }),
    "value.baselineSpend": M("u:portfolio_at_a_glance.spend_you_manage|roundedMillions", { why: "$280M is spend_you_manage rounded to whole millions" }),
    "value.highCategories": G("?", { why: "not in the contract" }),
    "value.savingsRange": G("?", { why: "a low-high range; not in the contract" }),
    "value.qualifiedCount": G("?", { why: "not in the contract" }),
    "value.coveredCount": G("?", { coincidence: true, why: "'Categories covered' is not the resilience initiative total; 21 is the same number by chance" }),
    "value.oldestDays": G("?", { why: "not in the contract" }),
    "value.qualifiedInitiatives": G("?", { why: "not in the contract" }),
    "action.page.suggest": G("custom", { why: "story.md: a handler of our own" }),
    "action.page.suggest#2": G("custom", { why: "story.md: a handler of our own" }),
  },
};

const src = path.join(ROOT, "examples");
const out = path.join(ROOT, "eval", "cases");
for (const ex of Object.keys(OVERRIDES).sort()) {
  const dir = path.join(src, ex);
  const spec = readContract(dir); // feature.json + apis, from `apis` or from an openapi file
  const page = fs.readFileSync(path.join(dir, spec.page), "utf8");
  const { matched, questions } = baselineAnalyze(extract(page), spec);
  const parts = describeParts(matched, questions);
  const parts_truth = {};
  const ov = OVERRIDES[ex];
  for (const p of parts) {
    if (ov[p.id]) parts_truth[p.id] = ov[p.id];
    else if (p.outcome === "accept" && DOC[ex]?.[p.id]) parts_truth[p.id] = M(p.accepted, { basis: DOC[ex][p.id] });
    else if (p.outcome === "accept") parts_truth[p.id] = { kind: "match", want: p.accepted, label: "self", basis: "Trace's own match; not independently established (fill the labelling worksheet to change this)" };
    else throw new Error(`${ex}: no ground truth for the asked part ${p.id}`);
  }
  for (const k of Object.keys(ov)) if (!parts.some((p) => p.id === k)) throw new Error(`${ex}: override for unknown part ${k}`);

  const cdir = path.join(out, `example-${ex}`);
  fs.mkdirSync(cdir, { recursive: true });
  fs.copyFileSync(path.join(dir, "feature.json"), path.join(cdir, "feature.json"));
  for (const f of ["openapi.json", "openapi.yaml", "openapi.yml"]) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(cdir, f));
  fs.copyFileSync(path.join(dir, spec.page), path.join(cdir, spec.page));
  if (fs.existsSync(path.join(dir, "story.md"))) fs.copyFileSync(path.join(dir, "story.md"), path.join(cdir, "story.md"));
  writeJson(path.join(cdir, "case.json"), {
    id: `example-${ex}`, category: "example", source: `examples/${ex}`,
    sourceHash: hashOf({ apis: spec.apis, page }),
    truth: parts_truth,
  });
  const tier = (l) => Object.values(parts_truth).filter((t) => t.label === l && !t.uncertain).length;
  console.log(`example-${ex}: ${parts.length} parts: ${tier("independent")} independent, ${tier("self")} self-labelled, ${Object.values(parts_truth).filter((t) => t.uncertain).length} uncertain`);
}
