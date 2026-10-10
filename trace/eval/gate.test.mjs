import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToBaseline, baselineFromReport } from "./gate.mjs";
import { readJson, here } from "./util.mjs";

const config = readJson(here("config.json"));
const fake = (over = {}) => {
  const all = { wrong_accept_rate: 0.01, recall: 0.9, oracle_accuracy: 0.95 };
  return {
    variant: "baseline", corpus: { hash: "h1", cases: 3 },
    headline: { all: { ...all, ...(over.headline ?? {}) } },
    categories: { a: { ...all, ...(over.cat ?? {}) } },
    determinism: { clean: over.clean ?? true, drift: over.drift ?? [], known_drift: [], key_order_sensitive_cases: over.ko ?? [], fingerprint_hash: "f" },
    cases: {}, triage: { by_type: [] }, report_hash: "r",
    ...(over.corpus ? { corpus: over.corpus } : {}),
  };
};
const base = baselineFromReport(fake());

test("an identical report passes", () => assert.equal(compareToBaseline(base, fake(), config).ok, true));

test("a worse fake report fails on wrong-accepts, recall and oracle accuracy", () => {
  for (const [over, what] of [[{ headline: { wrong_accept_rate: 0.05 } }, "wrong_accept_rate"], [{ headline: { recall: 0.8 } }, "recall"], [{ headline: { oracle_accuracy: 0.9 } }, "oracle_accuracy"]]) {
    const r = compareToBaseline(base, fake(over), config);
    assert.equal(r.ok, false, what);
    assert.match(r.failures.join("\n"), new RegExp(what));
  }
});

test("a change inside the tolerance passes, a per-category regression fails", () => {
  assert.equal(compareToBaseline(base, fake({ headline: { wrong_accept_rate: 0.011 } }), config).ok, true);
  assert.equal(compareToBaseline(base, fake({ cat: { recall: 0.5 } }), config).ok, false);
});

test("any determinism drift fails; so does a changed corpus", () => {
  assert.equal(compareToBaseline(base, fake({ clean: false, drift: [{ case: "x", check: "repeat" }] }), config).ok, false);
  assert.equal(compareToBaseline(base, fake({ corpus: { hash: "h2", cases: 3 } }), config).ok, false);
  assert.equal(compareToBaseline(base, fake({ ko: ["a"] }), config).ok, false, "more key-order sensitive cases than the baseline");
});

test("better numbers pass", () => assert.equal(compareToBaseline(base, fake({ headline: { recall: 0.99, wrong_accept_rate: 0 } }), config).ok, true));
