import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapCI, pairedDiff, judge } from "./stats.mjs";
import { emptyCounts } from "./metrics.mjs";

// a case with `wrong` wrong accepts out of 4 data parts
const rec = (id, wrong, cat = "c") => ({ id, category: cat, counts: { ...emptyCounts(), d_parts: 4, accepts: 4, correct_accepts: 4 - wrong, wrong_accepts: wrong } });
const set = (wrongs) => wrongs.map((w, i) => rec(`k${i}`, w));

test("the bootstrap is seeded: same seed same interval, other seed other interval", () => {
  const rs = set([0, 1, 0, 2, 0, 0, 1, 0, 3, 0]);
  const a = bootstrapCI(rs, "wrong_accept_rate", { seed: 7, iters: 300 });
  const b = bootstrapCI(rs, "wrong_accept_rate", { seed: 7, iters: 300 });
  const c = bootstrapCI(rs, "wrong_accept_rate", { seed: 8, iters: 300 });
  assert.deepEqual(a, b);
  assert.notDeepEqual([a.lo, a.hi], [c.lo, c.hi]);
  assert.ok(a.lo <= a.estimate && a.estimate <= a.hi);
});

test("a consistent difference is real, a wobble is noise, identical is identical", () => {
  const base = set(Array(20).fill(1));
  const worse = set(Array(20).fill(3));
  const r = pairedDiff(base, worse, "wrong_accept_rate", { seed: 1, iters: 300 });
  assert.equal(r.verdict, "real regression");
  const better = pairedDiff(worse, base, "wrong_accept_rate", { seed: 1, iters: 300 });
  assert.equal(better.verdict, "real improvement");
  const same = pairedDiff(base, base, "wrong_accept_rate", { seed: 1, iters: 300 });
  assert.equal(same.verdict, "identical");
  const wob = pairedDiff(set([0, 2, 0, 2, 0, 2, 0, 2]), set([2, 0, 2, 0, 2, 0, 2, 0]), "wrong_accept_rate", { seed: 1, iters: 300 });
  assert.equal(wob.verdict, "noise", "total is equal, only the assignment moved");
});

test("judge respects the direction of the metric", () => {
  assert.equal(judge("recall", 0.1, 0.05, 0.15), "real improvement");
  assert.equal(judge("wrong_accept_rate", 0.1, 0.05, 0.15), "real regression");
  assert.equal(judge("recall", 0.1, -0.05, 0.2), "noise");
});
