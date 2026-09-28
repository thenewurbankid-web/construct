import test from "node:test";
import assert from "node:assert/strict";
import { nameSimilarity, bestByName } from "./name-evidence.mjs";

test("nameSimilarity: identical names (any case/punctuation) score 1", () => {
  assert.equal(nameSimilarity("risk", "risk"), 1);
  assert.equal(nameSimilarity("riskScore", "risk_score"), 1);
  assert.equal(nameSimilarity("Risk-Score", "riskscore"), 1);
});

test("nameSimilarity: one name containing the other scores higher than mere token overlap", () => {
  const contains = nameSimilarity("totalRisk", "risk");
  const overlap = nameSimilarity("riskLevel", "riskScore"); // share the "risk" token, not a substring of each other
  assert.ok(contains > overlap, `${contains} should beat ${overlap}`);
  assert.ok(overlap > 0);
});

test("nameSimilarity: unrelated names score 0", () => {
  assert.equal(nameSimilarity("owner", "budget"), 0);
  assert.equal(nameSimilarity("", "owner"), 0);
  assert.equal(nameSimilarity(null, undefined), 0);
});

test("bestByName: a single clear winner by name is returned, by reference, from the candidate list", () => {
  const risk = { field: "risk" }, budget = { field: "budget" };
  const out = bestByName([risk, budget], "riskScore", (c) => c.field);
  assert.equal(out, risk);
});

test("bestByName: no evidence at all returns null (a real tie, still asked)", () => {
  const tied = [{ field: "colour" }, { field: "weight" }];
  assert.equal(bestByName(tied, "shippingMethod", (c) => c.field), null);
});

test("bestByName: an equal best score on more than one candidate returns null (still a real tie)", () => {
  const evenTied = [{ field: "ownerName" }, { field: "ownerEmail" }];
  assert.equal(bestByName(evenTied, "owner", (c) => c.field), null); // both contain "owner" equally; no unique winner
});

test("bestByName: fewer than two candidates, or no designName, returns null", () => {
  assert.equal(bestByName([{ field: "risk" }], "risk", (c) => c.field), null);
  const tied = [{ field: "a" }, { field: "b" }];
  assert.equal(bestByName(tied, null, (c) => c.field), null);
  assert.equal(bestByName(tied, "", (c) => c.field), null);
});
