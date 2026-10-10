// The ONE grouping entry point: `groupPage(source, options)`. The CLI (group.mjs), the web page (serve.mjs)
// and the eval (eval.mjs) all call it.
//
// Pipeline: parse JSX (Construct's parseJsxTree via ./construct.mjs) -> nodes -> describe each candidate
// subtree -> embed -> cluster (agglomerative, cosine threshold) -> split chaining artifacts (splitChainedClusters)
// -> merge literal-sibling near misses (mergeSiblingPeers) -> choose the enclosing subtree of each cluster ->
// resolve overlaps in tiers: (1) unique semantic blocks (form, header, nav, ...), (2) repeating groups, largest
// first, (3) other unique dense blocks. Groups are ordered by source position and get stable ids g1, g2, ...
//
// This file converges four independent fixes for the same underlying question -- "when does a near-miss cluster
// split or merge, and which of two conflicting clusters wins?" -- from four different angles, and future changes
// here should check all four together:
//   1. Thresholds (mergeSiblingPeers, SIBLING_MERGE_BAND): two literal-sibling clusters whose cross-cluster cosine
//      is a near miss just BELOW `threshold` get merged post-hoc, before tiering.
//   2. Pruning (isTrivialWrapper/hasOwnContent/passthroughWrapper, Rule 2): decides whether a semantic wrapper
//      around a repeating group should win outright, step aside, or be reported alongside it, based on whether the
//      wrapper has content of its own beyond the repeat.
//   3. Signature (literalRepeatOfAllChildren, plus describe.mjs's nchild:/branch: tokens): a semantic wrapper whose
//      entire set of direct children is itself one literal repeat steps aside in tier 1 so the repeat is reported
//      as a repeating group instead of one opaque unique block; the sharper describe.mjs signature also prevents
//      structurally-different blocks from false-merging just because their tag sequence matches.
//   4. Chaining (splitChainedClusters): guards against a cluster whose apparent coherence cannot be trusted -- one
//      chained together through an ancestor-descendant pair among its own members (never legitimate evidence of
//      "the same feature repeated", for any embedder) is broken back into singletons before it can ever compete
//      in tier 2's size-first acceptance, where its inflated size (it covers content that was never actually
//      compared to anything) would otherwise let it win a real conflict against a smaller, genuinely coherent
//      cluster it happens to enclose. This matters most with an embedder prone to spurious large-cluster
//      coherence (see embed.mjs's `centerBatch` for why that risk went up), but the guard itself doesn't look at
//      similarity at all -- see tier 2's comment for why a similarity-based (quality-vs-size) resort was tried
//      and reverted, and why this structural guard was the better fix.
// Tier 1 applies (2) and (3) together as complementary guards on the same loop (see below): a wrapper can be a
// passthrough (no content of its own) AND/OR entirely made of one literal repeat -- either is reason enough to
// step aside for the repeating group.
import { PARSER } from "./construct.mjs";
import { buildNodes, describe, isSemantic, subtree, propValue } from "./describe.mjs";
import { createEmbedder, cosine } from "./embed.mjs";
import { cluster } from "./cluster.mjs";

/** Default cosine threshold for merging clusters (hashed embedder). */
export const DEFAULT_THRESHOLD = 0.85;
/** Default minimum number of elements in a candidate subtree. */
export const DEFAULT_MIN_SIZE = 3;
/** A non-semantic unique block bigger than this share of the page is treated as a layout wrapper. */
export const MAX_BLOCK_SHARE = 0.6;
/**
 * How far below `threshold` two literal siblings (same immediate parent) may sit and still be merged into one
 * repeating group post-hoc (see `mergeSiblingPeers`). Kept narrow on purpose: it closes a near miss between two
 * whole blocks that are otherwise the same shape (one has a bit of unique content dragging its cosine down a
 * little), without reaching into the similarity band where genuinely different siblings live.
 */
export const SIBLING_MERGE_BAND = 0.03;

/** Raised when the page cannot be parsed. */
export class PageParseError extends Error {}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (a, b) => a.start <= b.start && b.end <= a.end;

function lca(nodes) {
  let cur = nodes[0];
  while (cur && !nodes.every((n) => contains(cur, n))) cur = cur.parent;
  return cur;
}

// A node counts as a "trivial wrapper" for this walk when it is one of the repeating group's own members, or when
// every one of its children is itself a trivial wrapper (i.e. the whole branch bottoms out in members, with
// nothing else along the way). A childless node that is NOT a member (an image, an icon, a stray span, a heading,
// a labelled input, ...) is real content and stops the walk -- deliberately structural, no literal text compared.
function isTrivialWrapper(node, memberIds) {
  if (memberIds.has(node.id)) return true;
  if (node.children.length === 0) return false;
  return node.children.every((c) => isTrivialWrapper(c, memberIds));
}

/**
 * Whether `container` has content of its own beyond `members` -- something a viewer would lose if `container`
 * were treated as nothing but a box around the repeat: another sibling element (a heading, a caption, a "Recent
 * orders" label, a table's `<thead>`, an extra button, ...) that isn't itself a trivial passthrough down to a
 * member, or `container`'s own `aria-label`/`title`. Used by both pruning rules below: a semantic wrapper WITHOUT
 * content of its own steps aside for a repeating group it fully encloses (rule 1), and a non-semantic wrapper WITH
 * content of its own is still reported alongside a repeating group it encloses (rule 2).
 *
 * @param {object} container A node from `buildNodes`.
 * @param {object[]} members The repeating group's member nodes (must all be inside `container`).
 * @returns {boolean} True when `container` says something `members` alone don't.
 */
function hasOwnContent(container, members) {
  const memberIds = new Set(members.map((m) => m.id));
  if (container.children.length && !container.children.every((c) => isTrivialWrapper(c, memberIds))) return true;
  return Boolean(propValue(container, "aria-label") || propValue(container, "title"));
}

/**
 * Whether any two of `nodes` stand in an ancestor-descendant relationship (one's span contains the other's).
 *
 * @param {object[]} nodes Nodes from `buildNodes`.
 * @returns {boolean} True when some pair is nested.
 */
function hasAncestorPair(nodes) {
  return nodes.some((a) => nodes.some((b) => a !== b && contains(a, b)));
}

/**
 * Guard against chaining artifacts: split any cluster that contains an ancestor-descendant pair among its own
 * members into one singleton cluster per member (as if none of them had ever merged), before the cluster ever
 * reaches dedup or tier acceptance.
 *
 * Why: a genuine "N near-identical subtrees, same feature repeated" cluster is never one member containing
 * another -- that would mean reporting a block as the same feature as its own parent. When it happens anyway, it
 * is because a wrapper's structural description is nearly identical to the one child it wraps (nothing of its own
 * -- see `hasOwnContent`), so the wrapper's *cross-cluster* similarity to whatever that child matches elsewhere on
 * the page rides along for free. Average-linkage clustering then reports one cluster spanning the wrapper, its
 * child, and whatever unrelated region the child legitimately matched -- e.g. a large "3-member repeat" of a
 * `<div>` that wraps a genuine 6-card grid, a structurally similar wrapper somewhere else on the page, and a third
 * unrelated wrapper, all only because each wrapper looks like its own (real, unrelated) child. Below, tier
 * acceptance ranks clusters partly by size (`Math.max` member size) specifically to prefer a block that covers
 * more of the page -- exactly the property this kind of cluster fakes, since the ancestor member's size includes
 * content that was never actually compared to anything. Left alone, that inflated size lets the false cluster
 * accept first and permanently block the real, smaller, higher-quality cluster it happens to enclose (this is
 * the regression this function exists to prevent -- see the report for the concrete case). The fix is not to keep
 * the reduced membership (the existing "drop a wrapper that contains another member of the *same* cluster" pass
 * a few lines below still does that, for a cluster that has no such pair to begin with): once a cluster is shown
 * to bridge an ancestor and its descendant, its whole coherence claim -- and the similarity score behind its
 * acceptance-order priority -- is not to be trusted, so every member goes back to being judged on its own.
 * Deterministic and order-preserving: no randomness, and clusters with no such pair pass through untouched.
 *
 * @param {{nodes: object[], descs: object[], similarity: number}[]} clusters Clusters from `cluster()`, mapped to
 *   `{nodes, descs, similarity}`.
 * @returns {{nodes: object[], descs: object[], similarity: number}[]} Clusters with any chained ones replaced by
 *   singletons, same relative order otherwise.
 */
function splitChainedClusters(clusters) {
  const out = [];
  for (const c of clusters) {
    if (c.nodes.length > 1 && hasAncestorPair(c.nodes)) {
      c.nodes.forEach((n, i) => out.push({ nodes: [n], descs: [c.descs[i]], similarity: 1 }));
    } else {
      out.push(c);
    }
  }
  return out;
}

function tagLabel(node) {
  return `<${node.tag}>`;
}

/**
 * A container's displayable tag: the node's own tag, except when the container is a bare JSX Fragment
 * (`<>...</>`), which has no tag of its own to label it with. In that case, fall back to whichever is more
 * informative: the fragment's children's shared tag ("3x SideNav.NavSection (via Fragment)"), when they all
 * share one, or else the nearest non-fragment ancestor's tag ("Nav (via Fragment)"). Only a lone top-level
 * fragment with neither falls back to the bare word "Fragment".
 *
 * @param {object} node A node from `buildNodes` (a group's `container`).
 * @returns {string} A tag name fit to display.
 */
function containerTag(node) {
  if (!node.isFragment) return node.tag;
  const childTags = [...new Set(node.children.filter((c) => !c.isFragment).map((c) => c.tag))];
  if (childTags.length === 1) return `${node.children.length}x ${childTags[0]} (via Fragment)`;
  let ancestor = node.parent;
  while (ancestor && ancestor.isFragment) ancestor = ancestor.parent;
  return ancestor ? `${ancestor.tag} (via Fragment)` : "Fragment";
}

function factsText(facts) {
  const bits = facts.flags.filter((f) => f !== "form" && f !== "table");
  if (facts.handlers.length) bits.push(`${facts.handlers.join("/")} ${facts.handlers.length > 1 ? "handlers" : "handler"}`);
  return bits.length ? ` with ${bits.join(", ")}` : "";
}

/**
 * Second pass over `cluster()`'s flat output: merge two clusters that are literal siblings (every node in both
 * shares the same immediate parent -- e.g. two columns of the same row) when their cross-cluster cosine similarity
 * is a near miss on `threshold` (within `SIBLING_MERGE_BAND`, not just anywhere below it).
 *
 * Why: a flat cosine cutoff clusters whole subtrees. When two sibling blocks are almost, but not quite, identical
 * (one has a little unique content the other lacks -- e.g. a stat panel with a colour-grid column next to two
 * plainer columns), their *whole* subtrees can fall just under `threshold` while their *children* (matching header
 * rows, matching body rows) still cluster fine on their own. The flat cutoff then reports several small groups of
 * matching pieces instead of one repeating group of the two whole siblings -- more fragmented than the page
 * actually is. Requiring literal siblings (not just "close enough" anywhere on the page) keeps this narrow: it
 * will not merge two similar-looking blocks that happen to sit in unrelated parts of the page.
 *
 * @param {{nodes: object[], descs: object[], similarity: number}[]} clusters Clusters from `cluster()`, mapped to
 *   `{nodes, descs, similarity}` (mutated array: entries may be removed and a merged entry appended).
 * @param {number[][]} vectors Embeddings, indexed like `candidates` (same order `clusters[].nodes` were built from).
 * @param {object[]} candidates The candidate nodes `vectors` are indexed by (used to recover each node's vector).
 * @param {number} threshold The main merge threshold.
 * @returns {{nodes: object[], descs: object[], similarity: number}[]} The clusters after merging (same array).
 */
function mergeSiblingPeers(clusters, vectors, candidates, threshold) {
  const byNode = new Map(candidates.map((n, i) => [n, vectors[i]]));
  const vecOf = (n) => byNode.get(n);
  const meanCosine = (nodes) => {
    if (nodes.length < 2) return 1;
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        total += cosine(vecOf(nodes[i]), vecOf(nodes[j]));
        pairs++;
      }
    }
    return total / pairs;
  };
  const literalSiblings = (a, b) => {
    const parent = a.nodes[0].parent;
    return parent != null && a.nodes.every((n) => n.parent === parent) && b.nodes.every((n) => n.parent === parent);
  };
  const crossSimilarity = (a, b) => {
    let total = 0;
    let pairs = 0;
    for (const n of a.nodes) for (const m of b.nodes) { total += cosine(vecOf(n), vecOf(m)); pairs++; }
    return pairs ? total / pairs : -Infinity;
  };

  for (;;) {
    let bi = -1;
    let bj = -1;
    let best = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!literalSiblings(clusters[i], clusters[j])) continue;
        const sim = crossSimilarity(clusters[i], clusters[j]);
        if (sim >= threshold - SIBLING_MERGE_BAND && sim < threshold && sim > best) {
          best = sim;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    const nodes = [...clusters[bi].nodes, ...clusters[bj].nodes];
    const merged = { nodes, descs: [...clusters[bi].descs, ...clusters[bj].descs], similarity: meanCosine(nodes) };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  return clusters;
}

function reasonFor({ kind, members, sim, viaMap, scattered, semantic, facts, wrapsRepeat }) {
  if (kind === "repeating") {
    const tags = [...new Set(members.map(tagLabel))].join("/");
    if (members.length === 1) return `${tags} rendered once per item by .map(); one template for a list${factsText(facts)}`;
    const how = viaMap ? "rendered by .map()" : scattered ? "similar structure at separate places" : "adjacent siblings";
    return `${members.length} ${tags} subtrees with near-identical structure (mean cosine ${sim.toFixed(2)}), ${how}${factsText(facts)}`;
  }
  if (wrapsRepeat) return `wrapper ${tagLabel(members[0])} around a repeating group, with its own heading/caption/label${factsText(facts)}`;
  if (semantic) return `semantic ${tagLabel(members[0])} block${factsText(facts)}`;
  return `dense block ${tagLabel(members[0])}${factsText(facts)}`;
}

/**
 * Group the JSX elements of a page into candidate feature components.
 *
 * @param {string} source TSX/JSX page text.
 * @param {object} [options] Options.
 * @param {string} [options.file] Name to report (default `"<input>"`).
 * @param {number} [options.threshold] Cosine merge threshold (default: the embedder's own, 0.85 for hashed).
 * @param {number} [options.minSize] Minimum elements in a candidate subtree (default 3); waived for a subtree
 *   rendered by `.map()`, where repetition itself is evidence the block is real (see `candidates` below).
 * @param {string} [options.embedder] `"hashed"` or `"ollama"` (default env FG_EMBEDDER, else hashed).
 * @param {object} [options.env] Environment for the embedder choice (default process.env).
 * @param {object} [options.embedderImpl] A ready `{name, embed}` embedder, used instead of `options.embedder`.
 * @param {object} [options.parser] Parser info from ./construct.mjs (default: this process's `PARSER`).
 * @returns {Promise<{file:string, engine:string, embedder:string, notice:string|null, threshold:number,
 *   totals:{elements:number, candidates:number, groups:number, grouped:number, ungrouped:number}, groups:object[]}>}
 *   Same input and options give the same result. Each group is `{id, kind, component, lines, container, memberCount,
 *   elements, similarity, reason, members:[{id, tag, line, endLine, elements}]}`, where `container` is
 *   `{id, tag, from, to}` for the group's lowest common ancestor (`tag` is a display label -- see `containerTag`
 *   for what a bare JSX Fragment container falls back to) or `null` when the group has no members.
 * @throws {PageParseError} When the source cannot be parsed or has no JSX.
 */
export async function groupPage(source, options = {}) {
  const { file = "<input>", minSize = DEFAULT_MIN_SIZE, parser = PARSER } = options;
  let tree;
  try {
    tree = parser.parseJsxTree(source);
  } catch (e) {
    throw new PageParseError(`cannot parse ${file}: ${String(e.message).split("\n")[0]}`);
  }
  const { nodes } = buildNodes(tree, source);
  if (!nodes.length) throw new PageParseError(`no JSX elements found in ${file}`);

  // A `.map()`-rendered subtree stays a candidate even below `minSize`: repetition is itself the signal that a
  // small chip, tag or icon-button template is a real, reusable block, not noise. A one-off small element without
  // that signal still needs `minSize` to keep out clutter (see the trivial-page test in feature-grouper.test.mjs).
  const candidates = nodes.filter((n) => !n.isFragment && (n.size >= minSize || n.viaMap));
  let embedder;
  let notice = null;
  if (options.embedderImpl) embedder = options.embedderImpl;
  else ({ embedder, notice } = await createEmbedder({ kind: options.embedder, env: options.env }));
  const threshold = options.threshold ?? embedder.defaultThreshold ?? DEFAULT_THRESHOLD;
  const descriptions = candidates.map(describe);
  const vectors = candidates.length ? await embedder.embed(descriptions) : [];
  let clusters = cluster(vectors, threshold).map((c) => ({
    nodes: c.members.map((i) => candidates[i]),
    similarity: c.similarity,
    descs: c.members.map((i) => descriptions[i]),
  }));
  // Ancestor-pair guard (see splitChainedClusters): applied right after raw clustering, before mergeSiblingPeers,
  // so a chaining artifact never gets the chance to look like a legitimate literal-sibling repeat. Safe to run
  // before mergeSiblingPeers: that pass only ever merges two clusters that are already, node for node, literal
  // siblings under the same parent, and siblings can never contain one another, so it cannot re-introduce an
  // ancestor pair into a cluster this just cleared.
  clusters = splitChainedClusters(clusters);
  clusters = mergeSiblingPeers(clusters, vectors, candidates, threshold);

  // Within a cluster, drop a wrapper that contains another member of the same cluster (keep the inner one).
  for (const c of clusters) {
    const keep = c.nodes.map((n) => !c.nodes.some((m) => m !== n && contains(n, m)));
    c.descs = c.descs.filter((_, i) => keep[i]);
    c.nodes = c.nodes.filter((_, i) => keep[i]);
  }

  const accepted = [];
  const blocked = (node) => accepted.some((g) => g.members.some((m) => overlaps(m, node)));
  const tryAccept = (c, tierName) => {
    const members = c.nodes.filter((n) => !blocked(n));
    if (!members.length) return null;
    const descs = c.descs.filter((_, i) => !blocked(c.nodes[i]));
    const viaMap = members.every((m) => m.viaMap);
    const kind = members.length > 1 || viaMap ? "repeating" : "unique";
    const container = lca(members);
    const scattered = members.length > 1 && !members.every((m) => m.parent === members[0].parent);
    return { kind, members, container, viaMap, scattered, similarity: members.length > 1 ? c.similarity : 1, facts: descs[0].facts, tierName };
  };
  const bySize = (a, b) => Math.max(...b.nodes.map((n) => n.size)) - Math.max(...a.nodes.map((n) => n.size)) || a.nodes[0].start - b.nodes[0].start;
  // Tier 2 acceptance order: size-first, same as before -- see the report for why a "quality before size"
  // re-sort (tried during this change, per the original brief's fix direction #1) was reverted. It broke two
  // pinned, legitimate cases where an ENCLOSING repeat sits a hair below a nested repeat's cosine on purpose
  // (signup.tsx's three footer `<div className="col">` wrappers, each an `<h4>` + `<ul>`, at mean cosine 0.9955,
  // vs. their three nested `<ul>`s alone at a perfect 1.0; figma-1's near-threshold `div@85`/`div@150` pair at
  // 0.856, pinned specifically as "near-threshold... a genuine match, not a false merge") -- in both, demoting
  // the lower-cosine outer cluster let its own nested nodes' cluster win first and permanently block it, losing
  // the caption/heading content the outer block alone carries. An outer repeat scoring a little under its own
  // nested slice is the common case, not a quality signal. The real bug this task set out to fix (a large,
  // structurally-unrelated cluster outranking a small, correct one by size) turned out to be fully addressed by
  // `splitChainedClusters` below instead: that false cluster only existed because it chained an ancestor and a
  // descendant together (see there), and once such a cluster is split back into singletons at formation time, it
  // never reaches this sort with an inflated size to win with in the first place -- no separate quality-vs-size
  // rule was needed on top, and adding one blindly cost more (see above) than it fixed.
  const isRepeatCluster = (c) => c.nodes.length > 1 || c.nodes.every((n) => n.viaMap);
  const total = nodes.length;

  // Rule 1 (fixes "a form/nav/table always beats a repeating group inside it"): a semantic wrapper that is a pure
  // passthrough for a repeating group it fully encloses -- nothing of its own beyond the repeat -- steps aside in
  // tier 1 so the repeating group gets reported in tier 2 instead. A wrapper that DOES have content of its own
  // (a heading, a `<thead>`, its own aria-label/title -- see `hasOwnContent`) still wins as before: e.g. a
  // `<table>` with a header row over repeating `<tr>`s stays one "table" group, not exploded into its rows, and
  // a `<footer>` with nothing but three near-identical link columns steps aside so the columns are the group.
  const passthroughWrapper = (node) => {
    const wrapped = clusters.find((rc) => isRepeatCluster(rc) && rc.nodes.every((m) => m !== node && contains(node, m)));
    return wrapped ? !hasOwnContent(node, wrapped.nodes) : false;
  };

  // A semantic wrapper (e.g. <footer>) whose ENTIRE set of direct children is one literal repeating group (2+
  // same-shape siblings, e.g. three <div className="col"> footer columns) is more useful reported as that
  // repeating group than as one opaque unique block: the columns are separate content, only coincidentally equal
  // in shape. Require the repeat to cover every direct child (not just some of them) so a block that mixes a
  // repeated part with other unique content -- e.g. a <form> with two repeating <fieldset>s plus a lone terms
  // checkbox and a submit button -- is left alone and still reported as one unique block. Single-member
  // .map()-template clusters (kind "repeating" via viaMap, not a literal sibling count) don't count here either;
  // this only demotes an actual multi-sibling repeat.
  const literalRepeatOfAllChildren = (node) => clusters.some((rc) => rc.nodes.length >= 2 && rc.nodes.length === node.children.length
    && rc.nodes.every((n) => n.parent === node));

  // Tier 1: unique semantic blocks, outermost first. Two independent guards can each make a wrapper step aside for
  // a repeating group it encloses -- passthroughWrapper (pruning: no content of its own beyond the repeat) and
  // literalRepeatOfAllChildren (signature: every direct child is itself part of one literal repeat) -- and either
  // is reason enough, so both apply to the same loop.
  for (const c of clusters.filter((c) => !isRepeatCluster(c) && isSemantic(c.nodes[0]) && !passthroughWrapper(c.nodes[0])).sort(bySize)) {
    if (literalRepeatOfAllChildren(c.nodes[0])) continue;
    const g = tryAccept(c);
    if (g) accepted.push({ ...g, semantic: true });
  }
  // Tier 2: repeating groups (siblings, .map() templates, similar blocks), largest first.
  for (const c of clusters.filter(isRepeatCluster).sort(bySize)) {
    const g = tryAccept(c);
    if (!g) continue;
    accepted.push({ ...g, semantic: false });
  }
  // Tier 3: other unique dense blocks, outermost first, skipping page-sized layout wrappers.
  for (const c of clusters.filter((c) => !isRepeatCluster(c) && !isSemantic(c.nodes[0])).sort(bySize)) {
    if (c.nodes[0].size > MAX_BLOCK_SHARE * total) continue;
    const g = tryAccept(c);
    if (g) accepted.push({ ...g, semantic: false });
  }
  // Rule 2 (fixes "a wrapper around a repeating group is dropped"): for each accepted repeating group, if its
  // enclosing container (already computed as `container` below) has content of its own beyond the repeat -- e.g. a
  // `<section>` titled "Recent orders" wrapping repeated `<OrderRow>`s -- report that container as an additional
  // "unique" group too, so the title isn't silently lost. This is the one deliberate exception to groups never
  // overlapping: the wrapper's span includes the repeat's members on purpose, because it is annotating them, not
  // competing with them for the same feature. A container with nothing of its own (a bare layout div) is not
  // reported again -- it was already correctly dropped, and still shows up as that group's `container` field.
  // Semantic containers are excluded here because rule 1 above already decided their fate (win outright, or step
  // aside entirely) -- they are never *added alongside* their repeat.
  for (const g of accepted.filter((a) => a.kind === "repeating").slice()) {
    const container = g.container;
    if (!container || g.members.includes(container) || isSemantic(container)) continue;
    if (accepted.some((a) => a.members.length === 1 && a.members[0] === container)) continue;
    if (!hasOwnContent(container, g.members)) continue;
    accepted.push({
      kind: "unique", members: [container], container, viaMap: false, scattered: false, similarity: 1,
      facts: describe(container).facts, semantic: false, wrapsRepeat: true,
    });
  }

  accepted.sort((a, b) => a.members[0].start - b.members[0].start);
  const groups = accepted.map((g, i) => {
    const elements = g.members.reduce((s, m) => s + m.size, 0);
    const first = g.members[0];
    return {
      id: `g${i + 1}`,
      kind: g.kind,
      component: first.component,
      lines: { from: Math.min(...g.members.map((m) => m.line)), to: Math.max(...g.members.map((m) => m.endLine)) },
      container: g.container ? { id: g.container.id, tag: containerTag(g.container), from: g.container.line, to: g.container.endLine } : null,
      memberCount: g.members.length,
      elements,
      similarity: Number(g.similarity.toFixed(3)),
      reason: reasonFor({ kind: g.kind, members: g.members, sim: g.similarity, viaMap: g.viaMap, scattered: g.scattered, semantic: g.semantic, facts: g.facts, wrapsRepeat: g.wrapsRepeat }),
      members: g.members.map((m) => ({ id: m.id, tag: m.tag, line: m.line, endLine: m.endLine, elements: m.size })),
    };
  });
  const grouped = new Set();
  for (const g of accepted) for (const m of g.members) for (const n of subtree(m)) grouped.add(n.id);
  const result = {
    file,
    engine: parser.engine,
    embedder: embedder.name,
    notice,
    threshold,
    totals: { elements: nodes.length, candidates: candidates.length, groups: groups.length, grouped: grouped.size, ungrouped: nodes.length - grouped.size },
    groups,
  };
  // The node tree (parent links: circular) for callers that need it (eval); not enumerable, so never serialised.
  Object.defineProperty(result, "nodes", { value: nodes, enumerable: false });
  return result;
}
