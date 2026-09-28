// Structure hashing for the Page map: two elements have the same SHAPE when their tags and the order of their
// children (elements, text, expressions) are the same; the words in the text and the values of props do not matter.
// Pure and deterministic. Works on the inventory's node records (see inventory.mjs), never on parser nodes.
import crypto from "node:crypto";

export const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

/** The children that take part in a shape: elements, and text/expression nodes that are not attribute text. */
export const shapeKids = (byId, node) => node.children.map((id) => byId.get(id)).filter((c) => !(c.kind === "text" && c.textKind === "attribute"));

/**
 * The shape string of a node: `tag(child,child)`; text is `#`, an expression `{}`.
 *
 * @param {Map<string, object>} byId Node records by id.
 * @param {object} node A node record.
 * @param {Map<string, string>} [memo] Cache, shared across calls on one inventory.
 * @returns {string} Shape string (same string = same structure).
 */
export function shapeOf(byId, node, memo = new Map()) {
  if (memo.has(node.id)) return memo.get(node.id);
  let s;
  if (node.kind === "text") s = node.textKind === "expression" ? "{}" : "#";
  else s = `${node.tag}(${shapeKids(byId, node).map((c) => shapeOf(byId, c, memo)).join(",")})`;
  memo.set(node.id, s);
  return s;
}

/** Short stable hash of a shape string. */
export const shapeHash = (shape) => sha1(shape).slice(0, 8);

/** How many nodes (elements and text) a subtree holds, itself included; attribute text is not counted. */
export function weightOf(byId, node) {
  if (node.kind === "text") return 1;
  return 1 + shapeKids(byId, node).reduce((n, c) => n + weightOf(byId, c), 0);
}

/**
 * Runs of adjacent sibling ELEMENTS with the same shape (same slot too), in source order. Text between two siblings
 * ends a run (they are not a plain repetition then). A run needs `min` members (3 by default) and some text in its first member.
 *
 * @param {Map<string, object>} byId Node records by id.
 * @param {object} parent The parent node.
 * @param {Map<string, string>} memo Shape cache.
 * @param {(el:object)=>number} minFor Minimum run length for a member (by its node); `Infinity` skips that kind of node.
 * @returns {{shape:string, members:object[]}[]} The runs, in source order.
 */
export function repeatRuns(byId, parent, memo, minFor) {
  const runs = [];
  let cur = null;
  for (const id of parent.children) {
    const el = byId.get(id);
    if (el.kind === "text") { if (el.textKind !== "attribute") cur = null; continue; }
    if (minFor(el) === Infinity) { cur = null; continue; }
    const shape = shapeOf(byId, el, memo);
    if (cur && cur.shape === shape && (cur.members[0].slot ?? null) === (el.slot ?? null)) cur.members.push(el);
    else { cur = { shape, members: [el] }; runs.push(cur); }
  }
  return runs.filter((r) => r.members.length >= minFor(r.members[0]) && hasText(byId, r.members[0]));
}

/** True when a subtree holds at least one text or expression node (attribute text does not count). */
export function hasText(byId, node) {
  if (node.kind === "text") return node.textKind !== "attribute";
  return shapeKids(byId, node).some((c) => hasText(byId, c));
}
