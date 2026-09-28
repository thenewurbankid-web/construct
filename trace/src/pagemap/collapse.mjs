// Removing repetition from the Page map's node tree. Pure and deterministic.
//
//   Repeated siblings   3+ adjacent siblings with the same shape (2+ for table rows), or a `.map()`-rendered row, become ONE
//                       group: the first instance is the template, the rest are its instances, and for every slot of the
//                       template (a text, an attribute text, a prop) the values that vary are listed as examples.
//   Repeated components The same shape at 2+ different places (a card used in several sections) is marked "repeated
//                       component xN" with the props and texts that vary; it is not merged, only marked.
//   Reversible          `visibleIds(inv, cx, "all")` is every node of the inventory in document order; nothing is deleted,
//                       a group only decides which instances a view shows.
//   `templateOf`        maps every node inside a non-template instance to its counterpart in the template (the alignment). Which of
//                       these links make a decision on the template cover the instance is decided by classify.mjs (`follow`): only the
//                       rows of a real list do; a stat strip or a row of chips has independent values.
import { sha1, shapeOf, shapeKids, weightOf, shapeHash } from "./shape.mjs";

const MAX_EXAMPLES = 4;
const MIN_COMPONENT_WEIGHT = 4; // a custom component (capitalised tag)
const MIN_LAYOUT_WEIGHT = 8; // a plain element: only a sizeable composition counts as a repeated component

// Pair up the nodes of two subtrees, position by position. Same shape: every node has a partner. Different shape (table
// rows that differ in a badge or a column): children are paired by index while their kind and tag agree; the rest is unpaired.
// Attribute text is matched by attribute name.
function alignSubtrees(inv, a, b, out = []) {
  out.push([a, b]);
  if (a.kind === "text") return out;
  const ak = shapeKids(inv.byId, a), bk = shapeKids(inv.byId, b);
  for (let i = 0; i < Math.min(ak.length, bk.length); i++) {
    if (ak[i].kind === "text" !== (bk[i].kind === "text") || (ak[i].kind !== "text" && ak[i].tag !== bk[i].tag)) break;
    alignSubtrees(inv, ak[i], bk[i], out);
  }
  const attrsB = new Map(b.children.map((id) => inv.byId.get(id)).filter((c) => c.kind === "text" && c.textKind === "attribute").map((c) => [c.attr, c]));
  for (const c of a.children.map((id) => inv.byId.get(id)).filter((c) => c.kind === "text" && c.textKind === "attribute")) if (attrsB.has(c.attr)) out.push([c, attrsB.get(c.attr)]);
  return out;
}

const hasTextNode = (byId, n) => n.children.some((id) => { const c = byId.get(id); return c.kind === "text" ? c.textKind !== "attribute" : hasTextNode(byId, c); });
const distinct = (values) => [...new Set(values)];

// The slots (text, attribute text, string props) of the template and the values they take across the members.
function slotsOf(inv, template, members) {
  const maps = members.map((m) => new Map(alignSubtrees(inv, template, m).map(([t, x]) => [t.id, x])));
  const slots = [];
  const elIdx = (n) => { const p = n.parent && inv.byId.get(n.parent); return p ? shapeKids(inv.byId, p).filter((c) => c.kind !== "text").indexOf(n) : 0; };
  const pathOf = (n) => { const parts = []; for (let x = n; x && x.id !== template.id; x = inv.byId.get(x.parent)) parts.unshift(x.kind === "text" ? (x.attr ? `@${x.attr}` : "#text") : `${x.tag}[${elIdx(x)}]`); return parts.join(">"); };
  alignSubtrees(inv, template, template).forEach(([t]) => {
    const values = maps.map((mp) => mp.get(t.id));
    if (t.kind === "text") {
      const texts = values.map((v) => v?.text ?? null); // null: this instance has no counterpart (a conditional badge)
      slots.push({ nodeId: t.id, nodeIds: values.map((v) => v?.id ?? null), path: pathOf(t), type: t.textKind === "attribute" ? "attribute" : "text", values: texts, varies: distinct(texts.filter((x) => x !== null)).length > 1, examples: distinct(texts.filter((x) => x !== null)).slice(0, MAX_EXAMPLES) });
    } else {
      const props = new Set(values.flatMap((v) => Object.entries(v?.props ?? {}).filter(([, x]) => typeof x === "string").map(([k]) => k)).concat(Object.entries(t.props ?? {}).filter(([, x]) => typeof x === "string").map(([k]) => k)));
      for (const k of [...props].sort()) {
        if (/^(data-|key$|className$|class$|style$)/.test(k)) continue; // styling differences are not content
        const vs = values.map((v) => (typeof v?.props?.[k] === "string" ? v.props[k] : null));
        if (distinct(vs).length > 1) slots.push({ nodeId: t.id, nodeIds: values.map((v) => v?.id ?? null), path: pathOf(t), type: "prop", prop: k, values: vs, varies: true, examples: distinct(vs).filter((x) => x !== null).slice(0, MAX_EXAMPLES) });
      }
    }
  });
  return slots;
}

/**
 * Collapse the repetition of an inventory.
 *
 * @param {ReturnType<typeof import("./inventory.mjs").buildInventory>} inv The inventory.
 * @returns {{groups: object[], templateOf: Object<string,string>, instancesOf: Object<string,string[]>, cv: Object<string,object[]>,
 *   components: object[], componentOf: Object<string,string>, stats: {total:number, visible:number, groups:number, components:number}}}
 *   `groups` {id, parent, template, members, count (null when mapped), mapped, slots}; `cv` the children view of every node (entries `{id}` or `{g}`).
 *
 * @example
 * collapse(buildInventory(src)).stats; // => { total: 368, visible: 213, groups: 9, components: 2 }
 */
export function collapse(inv) {
  const { byId } = inv;
  const memo = new Map();
  const groups = [];
  const templateOf = {}, instancesOf = {}, groupOf = new Map();
  for (const g of inv.groups) {
    const tpl = byId.get(g.members[0]);
    const members = g.members.map((id) => byId.get(id));
    const slots = members.length > 1 ? slotsOf(inv, tpl, members) : [];
    const links = {}; // instance node -> template node, for this group
    for (const m of members.slice(1)) for (const [t, x] of alignSubtrees(inv, tpl, m)) { templateOf[x.id] = t.id; links[x.id] = t.id; (instancesOf[t.id] ??= []).push(x.id); }
    const eg = { id: g.id, parent: g.parent, template: tpl.id, members: g.members, count: g.mapped ? null : g.members.length, mapped: g.mapped, shape: g.shape, slots, links };
    groups.push(eg);
    for (const m of g.members) groupOf.set(m, eg);
  }
  // children views: a run collapses into one entry at the position of its first member
  const cv = {};
  for (const n of inv.nodes) {
    if (n.kind === "text") continue;
    const list = [];
    for (const id of n.children) {
      const g = groupOf.get(id);
      if (!g) list.push({ id });
      else if (g.members[0] === id) list.push({ g: g.id });
    }
    cv[n.id] = list;
  }
  // repeated components: the same tag+shape at 2+ visible places (not rows of a group)
  const visible = new Set(visibleIds(inv, { groups, cv }, new Set()));
  const cand = new Map();
  for (const n of inv.nodes) {
    if (n.kind === "text" || n.kind === "cell" || n.id === "root" || !visible.has(n.id) || groupOf.has(n.id)) continue;
    if (weightOf(byId, n) < (/^[A-Z]/.test(n.tag) ? MIN_COMPONENT_WEIGHT : MIN_LAYOUT_WEIGHT)) continue;
    const key = `${n.tag}#${shapeHash(shapeOf(byId, n, memo))}`;
    (cand.get(key) ?? cand.set(key, []).get(key)).push(n);
  }
  const covered = new Set();
  const components = [], componentOf = {};
  const below = (n, set = new Set()) => { for (const id of n.children) { set.add(id); below(byId.get(id), set); } return set; };
  for (const [key, occ] of [...cand].sort((a, b) => weightOf(byId, b[1][0]) - weightOf(byId, a[1][0]) || (a[0] < b[0] ? -1 : 1))) {
    const live = occ.filter((n) => !covered.has(n.id));
    if (live.length < 2) continue;
    if (!live.every((n) => hasTextNode(byId, n))) continue;
    const slots = slotsOf(inv, live[0], live).filter((s) => s.varies);
    const c = { id: "rc" + sha1(key).slice(0, 8), tag: live[0].tag, count: live.length, weight: weightOf(byId, live[0]), ids: live.map((n) => n.id), varying: slots.map(({ path, type, prop, examples }) => ({ path, type, ...(prop ? { prop } : {}), examples })) };
    components.push(c);
    for (const n of live) { componentOf[n.id] = c.id; covered.add(n.id); for (const d of below(n)) covered.add(d); }
  }
  components.sort((a, b) => byId.get(a.ids[0]).start - byId.get(b.ids[0]).start);
  const total = inv.nodes.length - 1;
  const vis = visibleIds(inv, { groups, cv }, new Set()).length;
  return { groups, templateOf, instancesOf, cv, components, componentOf, stats: { total, visible: vis, groups: groups.length, components: components.length } };
}

/**
 * The ids of the nodes a view shows, in document order (the virtual root is not listed).
 *
 * @param {object} inv The inventory.
 * @param {{groups:object[], cv:object}} cx The collapse result.
 * @param {Set<string>|"all"} expanded Group ids whose instances are shown, or `"all"` for the full tree.
 * @returns {string[]} Node ids.
 */
export function visibleIds(inv, cx, expanded = new Set()) {
  const gById = new Map(cx.groups.map((g) => [g.id, g]));
  const out = [];
  const go = (id) => {
    if (id !== "root") out.push(id);
    const n = inv.byId.get(id);
    if (n.kind === "text") return;
    for (const e of cx.cv[id]) {
      if (e.id) go(e.id);
      else { const g = gById.get(e.g); for (const m of expanded === "all" || expanded.has(g.id) ? g.members : [g.template]) go(m); }
    }
  };
  go("root");
  return out;
}
