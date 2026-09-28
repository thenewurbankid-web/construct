// The Page map eval: deterministic, offline, and pinned so a later rule change cannot silently make the proposals worse.
import test from "node:test";
import assert from "node:assert/strict";
import { runPagemapEval, renderMd, PAGES } from "./pagemap.mjs";

test("the report is byte-identical on two runs, every node is accounted for, and the three real pages are covered", () => {
  const a = runPagemapEval(), b = runPagemapEval();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(renderMd(a), renderMd(b));
  assert.deepEqual(Object.keys(a.pages).sort(), PAGES.map((p) => p.subframe).sort());
  for (const r of Object.values(a.pages)) {
    assert.equal(r.coverage.accounted_for_percent, 100);
    assert.equal(r.coverage.dynamic + r.coverage.static + r.coverage.list + r.coverage.action + r.coverage.input + r.coverage.visual + r.coverage.structure + r.coverage.unsure, r.nodes.total);
    assert.ok(r.nodes.collapsed_visible < r.nodes.total);
  }
});

test("pinned: strong dynamic proposals stay precise, cover far more of the hand-marked values than the import rules alone, and the marked page yields more matched parts", () => {
  const rep = runPagemapEval();
  for (const [name, r] of Object.entries(rep.pages)) {
    const strong = r.dynamic.pagemap_strong, old = r.dynamic.import_strong;
    assert.ok(strong.precision >= 0.85, `${name}: precision ${strong.precision}`);
    assert.ok(strong.recall >= 0.75, `${name}: recall ${strong.recall}`);
    assert.ok(strong.recall > old.recall + 0.2, `${name}: better recall than the import rules (${strong.recall} vs ${old.recall})`);
    assert.ok(r.dynamic.pagemap_strong_plus_weak.recall >= 0.9, `${name}: weak included`);
    assert.ok(r.pipeline.pagemap_strong.extracted > r.pipeline.import_strong.extracted, name);
    assert.ok(r.pipeline.pagemap_strong.matched >= r.pipeline.import_strong.matched, name);
    assert.ok(r.pipeline.hand.extracted >= r.pipeline.pagemap_strong.extracted, "the hand-marked page stays the ceiling");
  }
  // the recomputed import-block baseline equals the numbers recorded in the extraction slice (parts extracted / matched)
  assert.deepEqual(Object.values(rep.pages).map((r) => [r.pipeline.import_strong.extracted, r.pipeline.import_strong.matched]), [[16, 4], [15, 5], [13, 4]]);
  assert.deepEqual(Object.values(rep.pages).map((r) => [r.pipeline.hand.extracted, r.pipeline.hand.matched]), [[36, 15], [36, 15], [25, 7]]);
});
