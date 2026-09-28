// Waiting versus Gap, decided from what the pipeline knows and not from how it words it (R1.1). The demo's leafState() reads
// the `waiting` flag that src/tree/model.mjs sets on a red cell whose Ask is open; these tests hold that to the pipeline's own
// open-item kinds and hints on every shipped example (all 12), and prove that rewording cannot change a state.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeState } from "../inspector/state.mjs";
import { buildTree } from "../tree/model.mjs";
import { leafState, summarize } from "./vocab.mjs";

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const NAMES = fs.readdirSync(examples).filter((d) => fs.existsSync(path.join(examples, d, "feature.json"))).sort();
const leavesOf = (tree) => tree.groups.flatMap((g) => g.leaves);
const baseId = (id) => String(id).split("#")[0];

test("all 12 shipped examples are covered", () => {
  assert.equal(NAMES.length, 12);
});

// What the pipeline says about a part after the answers are applied: its open item (hints.mjs openItems), by state / origin / viaContract.
function fromItem(item, id) {
  if (id === "list.none") return "gap"; // no list endpoint: nothing to ask, nothing to answer
  if (!item) return "fit";
  if (item.viaContract) return "gap"; // it only waits for the contract: there is no Ask to answer
  switch (item.state) {
    case "skipped": return item.origin === "tie" ? "tie" : "wait"; // an Ask that was skipped is still open
    case "tie": return "tie";
    case "placeholder": return "stub";
    case "missing": case "gap": return "gap"; // settled: answered "not in the API yet", or nothing to ask
    default: throw new Error(`unknown item state ${item.state}`);
  }
}

test("with the answers applied, every part's state agrees with the pipeline's open-item kind (12 examples, own answers and none)", async () => {
  let checked = 0;
  for (const name of NAMES) {
    for (const answers of [undefined, {}]) {
      const st = await computeState(path.join(examples, name), answers === undefined ? {} : { answers });
      for (const p of st.parts) {
        assert.equal(p.term, fromItem(p.item, p.id), `${name} ${answers ? "no answers" : "own answers"}: ${p.id} (item ${p.item?.state}/${p.item?.origin})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `checked ${checked} parts`);
});

// Before any answer the tree shows each Ask as open. The pipeline's own facts: the hint kind of the part and whether a question exists for it.
function fromHint(id, hint, asked) {
  if (id === "list.none") return "gap"; // no list endpoint at all
  if (!hint) return "fit";
  if (hint.kind === "tie") return "tie";
  if (hint.kind === "gap") return "gap";
  // "missing": a question is open, unless the contract is what is missing. One exception, unchanged since R1: a button that was not
  // skipped is still drawn with its open Ask ("what should it do?") when the contract is missing, so it is Waiting, not a Gap.
  if (hint.viaContract && !id.startsWith("action.")) return "gap";
  return asked ? "wait" : "gap";
}

test("before any answer, Waiting is exactly the parts that have an open question and are not waiting on the contract; the rest of the red is Gap (12 examples)", async () => {
  let waits = 0, gaps = 0;
  for (const name of NAMES) {
    const st = await computeState(path.join(examples, name), { answers: {} });
    const asked = new Set(st.qAll.map((q) => baseId(q.id)));
    const tree = buildTree(st.fresh, st.spec);
    for (const leaf of leavesOf(tree)) {
      const want = fromHint(leaf.id, st.hints.get(leaf.id), asked.has(leaf.id));
      const got = leafState(leaf);
      assert.equal(got, want, `${name}: ${leaf.id} (hint ${st.hints.get(leaf.id)?.kind}, asked ${asked.has(leaf.id)})`);
      if (got === "wait") waits++;
      if (got === "gap") gaps++;
    }
  }
  assert.ok(waits > 10 && gaps > 5, `both states occur (waiting ${waits}, gap ${gaps})`);
});

test("the flag is set by the pipeline on exactly the red cells with an open Ask, and on no other cell", async () => {
  for (const name of NAMES) {
    const st = await computeState(path.join(examples, name), { answers: {} });
    const asked = new Set(st.qAll.map((q) => baseId(q.id)));
    for (const leaf of leavesOf(buildTree(st.fresh, st.spec))) {
      for (const c of leaf.cells.filter(Boolean)) {
        if (c.waiting === undefined) continue;
        assert.equal(c.waiting, true);
        assert.equal(c.state, "missing", `${name}: ${leaf.id}: only a red cell carries it`);
        assert.ok(asked.has(leaf.id), `${name}: ${leaf.id}: flagged but no question is open`);
      }
    }
  }
});

// ---- wording cannot flip a state ----
const clone = (v) => structuredClone(v);
// every red cell gets words that match none of the pipeline's phrases; the Gap/Waiting decision must not notice
const reword = (tree) => { for (const l of leavesOf(tree)) l.cells.forEach((c, i) => { if (c?.state === "missing") { c.title = `zzz title ${i}`; c.sub = `zzz sub ${i}`; } }); return tree; };
const statesOf = (tree) => summarize(tree).states;

test("rewording every red cell's title and sub changes no state (Gap and Waiting come from the flag)", async () => {
  for (const name of NAMES) {
    for (const answers of [undefined, {}]) {
      const st = await computeState(path.join(examples, name), answers === undefined ? {} : { answers });
      for (const tree of [st.tree, buildTree(st.fresh, st.spec)]) assert.deepEqual(statesOf(reword(clone(tree))), statesOf(tree), `${name}`);
    }
  }
});

test("the old wording without the flag is a Gap, and the flag with any wording is Waiting", () => {
  const cell = (state, title, sub, extra = {}) => ({ state, title, sub, ...extra });
  const leaf = (...cells) => ({ id: "list.status", cells });
  assert.equal(leafState(leaf(cell("ok", "row.status"), cell("missing", "no transform", "x"), cell("missing", "not in API", "needs your answer"))), "gap", "words alone decide nothing");
  assert.equal(leafState(leaf(cell("ok", "row.status"), cell("missing", "no transform", "x"), cell("missing", "anything", "at all", { waiting: true }))), "wait");
  assert.equal(leafState(leaf(cell("ok"), cell("ok", "delete"), cell("missing", "endpoint missing", "needs DELETE"))), "gap");
  assert.equal(leafState(leaf(cell("ok"), cell("ok", "delete"), cell("missing", "changed words", "changed", { waiting: "yes" }))), "gap", "only true counts");
});

test("rewording an open item's hint, why or part name changes no state (states come from item state, origin and the leaf, not from text)", async () => {
  for (const name of NAMES) {
    const st = await computeState(path.join(examples, name), { answers: {} });
    const items = Object.fromEntries(Object.entries(st.items).map(([id, it]) => [id, { ...it, why: "changed why", hint: "changed hint", part: "changed part" }]));
    assert.deepEqual(summarize(st.tree, { items }).states, summarize(st.tree, { items: st.items }).states, name);
  }
});
