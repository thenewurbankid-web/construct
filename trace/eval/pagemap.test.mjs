// The Page map eval: deterministic, offline, and pinned so a later rule change cannot silently make the proposals worse.
import test from "node:test";
import assert from "node:assert/strict";
import { runPagemapEval, renderMd, PAGES, adjacentTexts, tolerantTextsOf, reverseSplitDyn, norm } from "./pagemap.mjs";
import { buildInventory } from "../src/pagemap/inventory.mjs";
import { extractParts } from "../src/import/index.mjs";

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

// LIN-199: a hand-marked value ($280M) that the Subframe page splits across two adjacent single-child
// elements ($280 in one <span>, M in the next) should be recoverable, without inventing a false match out of
// unrelated adjacent text.
test("split-value tolerance: adjacent text nodes recombine into a hand-marked value, but only when it is right", () => {
  const source = `
    function Page() {
      return (
        <div>
          <div className="a"><span>$280</span><span>M</span></div>
          <div className="b"><span>Hello</span><span>World</span></div>
        </div>
      );
    }
  `;
  const inv = buildInventory(source, { file: "split.tsx" });
  const byText = (t) => inv.nodes.find((n) => n.kind === "text" && n.text === t);
  const first = byText("$280"), second = byText("M"), unrelatedA = byText("Hello"), unrelatedB = byText("World");
  assert.ok(first && second && unrelatedA && unrelatedB, "fixture text nodes are found");

  // adjacentTexts() finds the split regardless of direction
  assert.deepEqual(adjacentTexts(first, inv), ["$280M"]);
  assert.deepEqual(adjacentTexts(second, inv), ["$280M"]);

  const truth = new Set([norm("$280M")]);
  const p = { strength: "strong" };
  // own text alone misses; the tolerant path recovers it from either side, since it is an actual hand-marked value
  assert.deepEqual(tolerantTextsOf(first, p, source, inv, truth), ["$280", "$280M"]);
  assert.deepEqual(tolerantTextsOf(second, p, source, inv, truth), ["M", "$280M"]);

  // two adjacent texts that are NOT a real split of a ground-truth value never get concatenated in as an extra proposal
  assert.deepEqual(tolerantTextsOf(unrelatedA, p, source, inv, truth), ["Hello"]);
  assert.deepEqual(tolerantTextsOf(unrelatedB, p, source, inv, truth), ["World"]);

  // a node whose own text already hits the truth is left alone (no needless extra candidate, no precision cost)
  const wholeTruth = new Set([norm("Hello")]);
  assert.deepEqual(tolerantTextsOf(unrelatedA, p, source, inv, wholeTruth), ["Hello"]);
});

// LIN-222: the same tolerance, for a value split across three (or more) adjacent sibling text nodes, not just two.
test("split-value tolerance: a 3-or-more-way adjacent split also recombines, without over-matching unrelated siblings", () => {
  const source = `
    function Page() {
      return (
        <div>
          <div className="a"><span>$</span><span>280</span><span>M</span></div>
          <div className="b"><span>Hello</span><span>Cruel</span><span>World</span></div>
        </div>
      );
    }
  `;
  const inv = buildInventory(source, { file: "split3.tsx" });
  const byText = (t) => inv.nodes.find((n) => n.kind === "text" && n.text === t);
  const dollar = byText("$"), num = byText("280"), unit = byText("M");
  const a = byText("Hello"), b = byText("Cruel"), c = byText("World");
  assert.ok(dollar && num && unit && a && b && c, "fixture text nodes are found");

  // adjacentTexts() finds the full 3-way concatenation from every position in the chain
  assert.ok(adjacentTexts(dollar, inv).includes("$280M"));
  assert.ok(adjacentTexts(num, inv).includes("$280M"));
  assert.ok(adjacentTexts(unit, inv).includes("$280M"));

  const truth = new Set([norm("$280M")]);
  const p = { strength: "strong" };
  assert.ok(tolerantTextsOf(dollar, p, source, inv, truth).includes("$280M"));
  assert.ok(tolerantTextsOf(num, p, source, inv, truth).includes("$280M"));
  assert.ok(tolerantTextsOf(unit, p, source, inv, truth).includes("$280M"));

  // three adjacent texts that are NOT a real split of a ground-truth value never get concatenated in as a match
  assert.deepEqual(tolerantTextsOf(a, p, source, inv, truth), ["Hello"]);
  assert.deepEqual(tolerantTextsOf(b, p, source, inv, truth), ["Cruel"]);
  assert.deepEqual(tolerantTextsOf(c, p, source, inv, truth), ["World"]);
});

// LIN-259: the reverse direction - a hand page marks two (or more) adjacent parts SEPARATELY (two data-dyn),
// while the Subframe page renders them as one combined text node. Still a miss before this: the Subframe
// node's own text ("$280M") never matched either of the hand page's two separate truth entries ("$280", "M").
test("reverse split-value tolerance: adjacent hand-marked values widen the truth set to their own combination", () => {
  const handSource = `
    function Page() {
      return (
        <div>
          <div className="a"><span data-dyn="part1">$280</span><span data-dyn="part2">M</span></div>
          <div className="b"><span data-dyn="x">Hello</span><span data-dyn="y">Cruel</span><span data-dyn="z">World</span></div>
        </div>
      );
    }
  `;
  const dyn = new Set(extractParts(handSource).values.map((v) => norm(v.example)));
  assert.deepEqual([...dyn].sort(), ["$280", "cruel", "hello", "m", "world"].sort());

  const inv = buildInventory(handSource, { file: "hand.jsx" });
  const extra = reverseSplitDyn(dyn, inv);

  // the two-part split combines into the real Subframe-side value...
  assert.ok(extra.has(norm("$280M")));
  // ...and the three-part run combines into every contiguous run, not just the full one
  assert.ok(extra.has(norm("HelloCruel")));
  assert.ok(extra.has(norm("HelloCruelWorld")));
  assert.ok(extra.has(norm("CruelWorld")));

  // nothing outside what is actually adjacent and hand-marked gets invented
  assert.ok(!extra.has(norm("M$280")));
  assert.ok(!extra.has(norm("WorldHello")));

  // a Subframe-side node that renders the combined string now scores as a hit against the widened truth
  const widenedTruth = new Set([...dyn, ...extra]);
  assert.deepEqual([...widenedTruth].filter((t) => t === norm("$280M")), [norm("$280M")]);
});
