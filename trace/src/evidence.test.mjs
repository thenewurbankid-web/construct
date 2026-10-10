// Label evidence: lexical, deterministic, and it never accepts anything by itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tokenize, stem, candidateWords, labelWords, evidence, describeEvidence } from "./evidence.mjs";
import { fieldDocsOf } from "./openapi.mjs";

const syn = JSON.parse(fs.readFileSync(new URL("./evidence.synonyms.json", import.meta.url), "utf8"));

test("the synonym table is small, lower-case, sorted, and no word sits in two groups", () => {
  const all = syn.groups.flat();
  assert.ok(syn.groups.length <= 16 && all.length <= 60, "keep it small: every entry is a claim");
  assert.deepEqual(syn.groups.map((g) => g[0]), syn.groups.map((g) => g[0]).sort(), "groups sorted by first word");
  for (const g of syn.groups) { assert.deepEqual(g, [...g].sort()); assert.ok(g.every((w) => w === w.toLowerCase())); assert.ok(g.length >= 2); }
  assert.equal(new Set(all).size, all.length, "a word in two groups would make matching order-dependent");
  for (const need of [["total", "sum", "amount", "spend", "cost"], ["count", "number", "qty", "n"], ["rank", "position", "order", "#"], ["id", "identifier"], ["name", "title", "label"], ["date", "at", "on", "time"], ["owner", "assignee", "lead", "requester"]]) {
    assert.equal(new Set(need.map((w) => tokenize(w)[0])).size, 1, `${need.join("/")} are one group`);
  }
});

test("tokenize: camelCase, snake_case, dotted paths, case, plural stems, stop words, numbers", () => {
  assert.deepEqual(tokenize("openCount"), ["open", "count"]);
  assert.deepEqual(tokenize("resilience_initiatives.total"), ["resilience", "initiative", "amount"]);
  assert.deepEqual(tokenize("Close on"), ["close", "at"]);
  assert.deepEqual(tokenize("HTTPStatus"), ["http", "status"].map((w) => tokenize(w)[0]));
  assert.deepEqual(tokenize("The number of ITEMS in 2026"), ["count"], "stop words, generic nouns and bare numbers drop out; number folds to count");
  assert.deepEqual(tokenize("#"), ["#"]);
  assert.deepEqual(tokenize("Rank"), ["#"], "rank and # are one group");
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("stem: light plural stemming only", () => {
  assert.equal(stem("categories"), "category");
  assert.equal(stem("items"), "item");
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("status"), "status");
  assert.equal(stem("class"), "class");
  assert.equal(stem("ids"), "id");
  assert.equal(stem("id"), "id");
});

const f = (field, more = {}) => ({ field, formatter: "asText", ...more });

test("supports: every word of the design's name is explained by the field (synonyms included)", () => {
  assert.equal(evidence({ label: { name: "totalSpend" }, candidate: f("amount") }).verdict, "supports", "total/spend/amount are one group");
  assert.equal(evidence({ label: { name: "rank" }, candidate: f("position") }).verdict, "supports");
  assert.equal(evidence({ label: { name: "owner", header: "Assignee" }, candidate: f("lead") }).verdict, "supports");
  assert.equal(evidence({ label: { name: "resilienceTotal" }, candidate: f("portfolio_at_a_glance.resilience_initiatives.total", { agg: "field" }) }).verdict, "supports");
  const e = evidence({ label: { name: "itemCount" }, candidate: { agg: "count", field: null, formatter: "asText" } });
  assert.deepEqual([e.verdict, e.score, e.matched], ["supports", 1, ["count"]]);
});

test("contradicts: the design has words, the field has words, and none meet (real: rank vs id, coveredCount vs total)", () => {
  assert.equal(evidence({ label: { name: "rank", header: "#" }, candidate: f("id") }).verdict, "contradicts");
  assert.equal(evidence({ label: { name: "coveredCount" }, candidate: f("portfolio.resilience_initiatives.total", { agg: "field" }) }).verdict, "contradicts");
});

test("neutral: a word the field does not explain (real: openCount vs count(), topOpen vs max(balance))", () => {
  const open = evidence({ label: { name: "openCount" }, candidate: { agg: "count", field: null, formatter: "asText" } });
  assert.deepEqual([open.verdict, open.score, open.matched, open.unmatched], ["neutral", 0.5, ["count"], ["open"]]);
  assert.equal(evidence({ label: { name: "topOpen" }, candidate: { agg: "max", field: "balance", formatter: "moneyCompact" } }).verdict, "neutral");
  assert.equal(evidence({ label: { name: "customerId" }, candidate: f("id") }).verdict, "neutral", "customer is unexplained");
});

test("neutral: no words in the design, or nothing to compare", () => {
  assert.deepEqual(evidence({ label: {}, candidate: f("id") }).verdict, "neutral");
  assert.deepEqual(evidence({ label: { name: "the" }, candidate: f("id") }).label, []);
  assert.equal(evidence({ label: { name: "rank" }, candidate: { formatter: "asText" } }).verdict, "neutral", "a candidate with no words");
});

test("the count's subject words (the list's name, its first column header) explain a noun in the design's name (real: roster projectCount)", () => {
  const c = { agg: "count", field: null, formatter: "asText" };
  assert.equal(evidence({ label: { name: "projectCount" }, candidate: c }).verdict, "neutral");
  assert.equal(evidence({ label: { name: "projectCount" }, candidate: c, subject: "roster Project" }).verdict, "supports");
  assert.equal(evidence({ label: { name: "categoryCount" }, candidate: c, subject: "categories" }).verdict, "supports", "categories -> category");
});

test("the design's own name and column header count; text next to it is only a fallback (7 high / 13 medium)", () => {
  assert.deepEqual(labelWords({ name: "impactMedium", inline: "high" }), { words: ["impact", "medium"], shown: ["impact", "medium"], source: "name" });
  assert.deepEqual(labelWords({ name: "", header: "Owner", inline: "x" }).words, ["assignee"].map((w) => tokenize(w)[0]));
  assert.deepEqual(labelWords({ name: "", inline: "open items" }), { words: ["open"], shown: ["open"], source: "nearby" });
  assert.deepEqual(labelWords({ name: "1", label: "Categories covered" }), { words: ["category", "covered"], shown: ["category", "covered"], source: "nearby" });
  assert.deepEqual(labelWords({}), { words: [], shown: [], source: "none" });
  assert.deepEqual(labelWords({ name: "totalSpend" }), { words: ["amount"], shown: ["total", "spend"].slice(0, 1), source: "name" }, "synonyms fold to one word; the design's first word is what is shown");
});

test("OpenAPI title and description of the field are candidate words, so a documented field can be vouched for", () => {
  const docs = { c_amt: { title: "Contract value", description: "Total spend for the year. Rounded." } };
  assert.equal(evidence({ label: { name: "totalSpend" }, candidate: f("c_amt") }).verdict, "contradicts", "without docs the cryptic name says nothing");
  assert.equal(evidence({ label: { name: "totalSpend" }, candidate: f("c_amt"), docs }).verdict, "supports");
  assert.deepEqual(candidateWords(f("c_amt"), { docs }), ["amt", "contract", "value", "amount", "year"]);
  assert.ok(!candidateWords(f("c_amt"), { docs }).includes("round"), "only the first sentence of a description is used");
  const doc = { components: { schemas: { A: { properties: { c_amt: { title: "Contract value", description: "Total spend for the year." }, id: {} } }, B: { properties: { c_amt: { title: "Contract value", description: "Total spend for the year." }, name: { description: "One thing" }, name2: { description: "x" } } } } } };
  assert.deepEqual(Object.keys(fieldDocsOf(doc)), ["c_amt", "name", "name2"]);
  const clash = { a: { properties: { x: { description: "one" } } }, b: { properties: { x: { description: "two" } } } };
  assert.deepEqual(fieldDocsOf(clash), {}, "a name documented two ways gives no evidence");
});

test("evidence is deterministic, has no side effects, and its result carries no accept: it is a verdict, not a decision", () => {
  const input = { label: { name: "openCount", header: "Open" }, candidate: { agg: "count", field: null, formatter: "asText" }, subject: "orders" };
  const before = JSON.stringify(input);
  const a = evidence(input), b = evidence(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(Object.keys(a).sort(), ["candidate", "label", "matched", "score", "source", "unmatched", "verdict"]);
  assert.ok(["supports", "contradicts", "neutral"].includes(a.verdict));
});

test("describeEvidence: one plain sentence per verdict", () => {
  const c = { agg: "count", field: null, formatter: "asText" };
  assert.match(describeEvidence(evidence({ label: { name: "itemCount" }, candidate: c })), /all explained/);
  assert.match(describeEvidence(evidence({ label: { name: "rank" }, candidate: { field: "id" } })), /none of the design's words \("rank"\) appear/);
  assert.match(describeEvidence(evidence({ label: { name: "openCount" }, candidate: c })), /explains "count" but not "open"/);
  assert.match(describeEvidence(evidence({ label: {}, candidate: c })), /no words for it/);
});
