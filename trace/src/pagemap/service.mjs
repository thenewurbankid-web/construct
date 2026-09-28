// The Page map's service: everything the routes need, with plain arguments and no HTTP. Pure except for reading the
// page and its contract, and for the four writes it is asked to make (the decisions sidecar and its history, the marked
// copy, and, on a second explicit step, the page itself). Deterministic: the same source, contract and decisions give
// the same payload, byte for byte (a test pins it).
import fs from "node:fs";
import path from "node:path";
import { buildInventory } from "./inventory.mjs";
import { collapse } from "./collapse.mjs";
import { classify, effectiveOf, coverage, rootOf, CLASS_KEYS, CLASS_LABELS } from "./classify.mjs";
import { contractMatcher } from "./contract-match.mjs";
import { applyDecisions, effectiveAll, diffOf } from "./apply.mjs";
import { wireframe } from "./preview.mjs";
import { readDecisionsChecked, setDecisions, undo, redo, summary, filesFor, saveViolations } from "./store.mjs";
import { sha1 } from "./shape.mjs";
import { textInNode } from "./inventory.mjs";
import { resolveInteractions, interactionCoverage } from "./interactions.mjs";
import { buildViolations, summarizeViolations } from "./violations.mjs";
import { diffFile } from "../diff.mjs";
import { ENGINE } from "../import/construct-ast.mjs";

/** The real Subframe pages that can be opened with `?file=`, and the example whose contract they are read against. */
export const REAL_PAGES = {
  "PortfolioHealthFigmaRebuild.tsx": "portfolio-figma-1",
  "PortfolioHealthFigmaRebuild2.tsx": "portfolio-figma-2",
  "RedesignedPortfolioHealth.tsx": "portfolio-redesigned",
};
export const ACTS = ["accept", "reject", "change", "add", "rename", "clear"];
export const MARK_CLASSES = ["dynamic", "static", "list", "action", "input", "visual"];
const NAME_OK = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const ID_OK = /^[ns][0-9a-f]{8,40}$/; // n: a node, s: a state record
const MAX_CHANGES = 3000;
const MAX_BACKUPS = 50;
let tmpSeq = 0;
const ACTIONABLE = new Set(["dynamic", "list", "action", "input"]);

export class PagemapError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const isExample = (examplesDir, name) => typeof name === "string" && /^[\w.-]+$/.test(name) && !/^\.+$/.test(name) && fs.existsSync(path.join(examplesDir, name, "feature.json"));

/**
 * Resolve a request's `example` or `file` to the page and the folder that holds its sidecar files.
 * Only known examples and the fixed list of real pages resolve; nothing else can name a path.
 *
 * @param {{examplesDir:string, pagesDir:string}} env Folders.
 * @param {{example?:unknown, file?:unknown}} q The request's parameters.
 * @returns {{mode:"example"|"file", example:string, key:string|null, dir:string, pagePath:string, pageFile:string, ext:string, marked:string, name:string}}
 * @throws {PagemapError} 404 for an unknown example, file or page.
 */
export function resolvePage({ examplesDir, pagesDir }, q) {
  if (q.file !== undefined && q.file !== null && q.file !== "") {
    const f = q.file;
    if (typeof f !== "string" || !Object.hasOwn(REAL_PAGES, f)) throw new PagemapError(404, "That page is not one Trace can open.");
    const example = REAL_PAGES[f];
    const pagePath = path.join(pagesDir, f);
    if (!isExample(examplesDir, example) || !fs.existsSync(pagePath)) throw new PagemapError(404, "That page is not one Trace can open.");
    const ext = path.extname(f), key = path.basename(f, ext);
    return { mode: "file", example, key, dir: path.join(examplesDir, example), pagePath, pageFile: f, ext, marked: `${key}.marked${ext}`, name: f };
  }
  if (!isExample(examplesDir, q.example)) throw new PagemapError(404, "That example does not exist.");
  const dir = path.join(examplesDir, q.example);
  let page = "page.jsx";
  try { const spec = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8")); if (typeof spec.page === "string") page = spec.page; } catch {}
  if (page !== path.basename(page) || !/\.(jsx|tsx|js)$/.test(page) || /\.marked\./.test(page)) throw new PagemapError(422, "The example's page file name is not one the Page map can use.");
  const pagePath = path.join(dir, page);
  if (!fs.existsSync(pagePath)) throw new PagemapError(404, "The example has no page file.");
  const ext = path.extname(page);
  return { mode: "example", example: q.example, key: null, dir, pagePath, pageFile: page, ext, marked: `${path.basename(page, ext)}.marked${ext}`, name: page };
}

/** The examples and real pages the Page map can open (for its picker). */
export function listPages({ examplesDir, pagesDir }) {
  const examples = fs.readdirSync(examplesDir).filter((d) => isExample(examplesDir, d)).sort().filter((d) => {
    try { resolvePage({ examplesDir, pagesDir }, { example: d }); return true; } catch { return false; }
  });
  const files = Object.keys(REAL_PAGES).filter((f) => fs.existsSync(path.join(pagesDir, f)) && isExample(examplesDir, REAL_PAGES[f])).sort();
  return { examples, files: files.map((f) => ({ file: f, example: REAL_PAGES[f] })) };
}

/**
 * Read and analyse a page: inventory, collapse, proposals. Pure given the files it reads.
 *
 * @param {ReturnType<typeof resolvePage>} ref The resolved page.
 * @returns {{ref:object, source:string, inv:object, cx:object, proposals:object, issues:object, follow:object, contract:object|null}} The analysis (also the context `apply.mjs` takes).
 * @throws {PagemapError} 422 when the page does not parse.
 */
export function analyse(ref) {
  const source = fs.readFileSync(ref.pagePath, "utf8");
  let inv;
  try { inv = buildInventory(source, { file: ref.pageFile }); } catch (e) { throw new PagemapError(422, `The page does not parse: ${e.message}`); }
  const cx = collapse(inv);
  const contract = contractMatcher(ref.dir);
  const { proposals, issues, follow } = classify(inv, cx, source, { contract });
  const states = inv.states;
  const warnings = [];
  const safe = (label, fn, fallback) => { try { return fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); return fallback; } }; // a broken side section never takes the page down
  const interactions = safe("interactions", () => resolveInteractions(inv, source, proposals, ref.dir), []);
  // charts and graphics: their labels, each mapped to the data items it could stand for (candidates only; the user confirms)
  const mappings = {};
  for (const n of inv.nodes) if (n.kind === "visual" && n.details.chart) safe("chart mapping", () => { mappings[n.id] = { labels: n.details.labels.map((label) => ({ label, items: contract ? contract.dataItemsFor(label) : [] })) }; }, null);
  return { ref, source, inv, cx, proposals, issues, follow, contract, states, interactions, mappings, warnings, baseWarnings: warnings.length, safe };
}

const strip = (n) => {
  const { spans, props, via, shape, ...rest } = n; // eslint-disable-line no-unused-vars
  const out = { ...rest };
  if (props) out.propNames = Object.keys(props).sort();
  return out;
};

// The decision to record for one requested change, or null to remove it. Throws PagemapError for anything invalid.
// What a decision was made on, kept with it: the position, the tag path, the text, and a signature of the node's kind, tag, path,
// text and structure. A decision only applies to a node whose signature still matches (see `liveDecisions`).
export function sigOf(inv, n) {
  return sha1(n.kind === "text" ? `t|${n.textKind}|${n.path}|${n.text}` : `${n.kind}|${n.tag}|${n.path}|${textInNode(inv.byId, n).slice(0, 200)}|${n.shape}`).slice(0, 12);
}
const anchorOf = (inv, node) => ({ line: node.line, col: node.col, path: node.path, ...(node.text ? { text: node.text.slice(0, 60) } : {}), sig: sigOf(inv, node) });

/**
 * The decisions that still apply, and the ones that do not. Node ids are positional, so after the page changes an id can
 * be gone (nothing there) or, when identical rows shift, land on a DIFFERENT node. A decision is live only if its node exists AND its
 * anchor still matches that node (signature; for older sidecars without one, the tag path and text). Everything else is an
 * orphan, listed for the user to re-attach or drop. Nothing is re-anchored silently, so apply and use can only ever mark the node that was decided.
 *
 * @param {ReturnType<typeof analyse>} a The analysis.
 * @returns {{live: Object<string,object>, orphans: {id:string, act:string, anchor:object|null, reason:string}[], warnings: string[], raw: Object<string,object>}}
 */
export function liveDecisions(a) {
  const { decisions: raw, warnings } = readDecisionsChecked(a.ref.dir, a.ref.key);
  const live = {}, orphans = [];
  const stateById = new Map(a.states.map((s) => [s.id, s]));
  for (const [id, d] of Object.entries(raw)) {
    const n = a.inv.byId.get(id), st = stateById.get(id);
    const anc = d.anchor;
    let reason = null;
    if (!n && !st) reason = "that node is no longer on the page (ids are positional)";
    else if (n && anc && anc.sig !== undefined && anc.sig !== sigOf(a.inv, n)) reason = "another node is at that position now";
    else if (n && anc && anc.sig === undefined && ((anc.path !== undefined && anc.path !== n.path) || (anc.text !== undefined && anc.text !== (n.text ?? "").slice(0, 60)))) reason = "another node is at that position now";
    else if (st && anc && anc.text !== undefined && anc.text !== st.condition.slice(0, 60)) reason = "another state is at that position now";
    if (reason) orphans.push({ id, act: d.act, anchor: anc ?? null, reason }); else live[id] = d;
  }
  return { live, orphans, warnings, raw };
}

function decisionFor(a, c, root, effNow) {
  const node = a.inv.byId.get(root);
  const p = a.proposals[root];
  const anchor = anchorOf(a.inv, node);
  if (c.act === "clear") return null;
  if (c.name !== undefined && !NAME_OK.test(c.name)) throw new PagemapError(422, `"${String(c.name).slice(0, 40)}" is not a usable name: start with a letter, then letters, digits or _ (40 at most).`, { id: c.id });
  const name = c.name && c.name !== p.name ? { name: c.name } : {};
  if (c.act === "reject") return { act: "reject", by: "user", anchor };
  if (c.act === "accept") return { act: "accept", by: c.name && c.name !== p.name ? "user" : "rule", ...name, anchor };
  if (c.act === "rename") {
    const cur = effNow[root];
    return cur.status === "changed" || cur.status === "added" ? { act: cur.status === "added" ? "add" : "change", cls: cur.cls, by: "user", ...name, anchor } : { act: "accept", by: "user", ...name, anchor };
  }
  if (!MARK_CLASSES.includes(c.cls)) throw new PagemapError(422, `"${String(c.cls).slice(0, 20)}" is not a class you can mark (${MARK_CLASSES.join(", ")}).`, { id: c.id });
  const wants = c.cls;
  if (wants === (p.cls === "unsure" ? p.lean : p.cls)) return { act: "accept", by: "user", ...name, anchor };
  return { act: p.cls === "structure" ? "add" : "change", cls: wants, by: "user", ...name, anchor };
}

/**
 * Record decisions for a page.
 *
 * @param {ReturnType<typeof analyse>} a The analysis.
 * @param {{changes?:{id:string, act:string, cls?:string, name?:string}[], bulk?:string}} body The request body.
 * @param {{now?:()=>string}} [opts] Clock for the history line (metadata only).
 * @returns {{entries:object[]}} The history lines written.
 * @throws {PagemapError} 400/422 for a malformed change, an unknown node or an unusable class or name.
 */
export function decide(a, body, opts = {}) {
  const { ref, inv } = a;
  const stateById = new Map(a.states.map((s) => [s.id, s]));
  const { live: decisions, raw: rawDecisions } = liveDecisions(a);
  const effNow = effectiveAll(a, decisions);
  let list = body.changes;
  if (body.bulk !== undefined) {
    if (body.bulk !== "accept-strong") throw new PagemapError(400, 'bulk must be "accept-strong".');
    const diffs = computeDiffs(a, decisions, effNow);
    list = pendingOf(a, decisions, diffs).filter((n) => a.proposals[n.id].strength === "strong" && a.proposals[n.id].cls !== "unsure").map((n) => ({ id: n.id, act: "accept" }));
    if (!list.length) return { entries: [] };
  }
  if (!Array.isArray(list) || !list.length) throw new PagemapError(400, "Nothing to decide: send changes[] or bulk.");
  if (list.length > MAX_CHANGES) throw new PagemapError(413, `Too many changes at once (${MAX_CHANGES} at most).`);
  const byRoot = new Map();
  for (const c of list) {
    if (c === null || typeof c !== "object" || Array.isArray(c)) throw new PagemapError(400, "Each change must be an object.");
    if (c.act === "clear" && typeof c.id === "string" && Object.hasOwn(rawDecisions, c.id) && !decisions[c.id]) { byRoot.set(c.id, null); continue; } // drop an orphaned decision
    if (typeof c.id !== "string" || !ID_OK.test(c.id) || !(inv.byId.has(c.id) || stateById.has(c.id)) || c.id === "root") throw new PagemapError(422, "That node is not on this page.", { id: String(c.id).slice(0, 20) });
    if (!ACTS.includes(c.act)) throw new PagemapError(422, `act must be one of ${ACTS.join(", ")}.`, { id: c.id });
    if (stateById.has(c.id)) { // a state record is accepted as a requirement, dismissed, or left again: nothing else
      if (!["accept", "reject", "clear"].includes(c.act)) throw new PagemapError(422, "A state can only be accepted, rejected or cleared.", { id: c.id });
      const s = stateById.get(c.id);
      byRoot.set(c.id, c.act === "clear" ? null : { act: c.act, by: "user", anchor: { line: s.line, col: s.col, path: s.stateKind, text: s.condition.slice(0, 60) } });
      continue;
    }
    const root = rootOf(a.follow, c.id);
    byRoot.set(root, decisionFor(a, c, root, effNow));
  }
  const r = setDecisions(ref.dir, ref.key, ref.pageFile, [...byRoot].map(([id, to]) => ({ id, to })), opts);
  persistViolations(a);
  return r;
}

/** Write the tracked violation list (as it stands after the decisions) into the sidecar. */
function persistViolations(a) {
  const v = a.safe("violations", () => buildViolations(a, liveDecisions(a).live), null);
  if (v) saveViolations(a.ref.dir, a.ref.key, a.ref.pageFile, v);
}

const rootsOf = (a) => a.inv.nodes.filter((n) => n.id !== "root" && !a.follow[n.id]);
const leanCls = (p) => (p.cls === "unsure" ? p.lean : p.cls);

// What accepting each root would write, as Trace's line diff, with the class it would have (nothing for a rejected or
// non-writing class). Roots only: an instance of a repeated row follows its template.
function computeDiffs(a, decisions, eff) {
  const diffs = {};
  for (const n of rootsOf(a)) {
    const p = a.proposals[n.id], e = eff[n.id];
    const cls = e.status === "rejected" ? null : p.cls === "unsure" && e.status === "proposed" ? p.lean : e.cls;
    if (!cls || !ACTIONABLE.has(cls) || (p.existing && cls === p.cls) || n.textKind === "attribute" || n.textKind === "expression") continue;
    let d = null;
    try { d = diffOf(a, n.id, { cls, name: e.name }); } catch (err) { a.warnings.push(`diff of ${n.id}: ${err.message}`); }
    if (d) diffs[n.id] = { added: d.added, removed: d.removed, hunks: d.hunks };
  }
  return diffs;
}
// The roots that still wait for a decision and whose acceptance writes something.
const pendingOf = (a, decisions, diffs) => rootsOf(a).filter((n) => !decisions[n.id] && !a.proposals[n.id].existing && !a.proposals[n.id].delegate && diffs[n.id] && ACTIONABLE.has(leanCls(a.proposals[n.id])));

/**
 * The full payload for a page: what the browser draws.
 *
 * @param {ReturnType<typeof analyse>} a The analysis.
 * @returns {object} JSON-safe payload (see docs/PAGEMAP.md).
 */
export function payload(a) {
  a.warnings.length = a.baseWarnings; // warnings from the analysis stay; those of an earlier payload do not pile up
  const { ref, inv, cx, proposals, issues, source } = a;
  const { live: decisions, orphans, warnings: sidecarWarnings } = liveDecisions(a);
  a.warnings.push(...sidecarWarnings);
  const eff = effectiveAll(a, decisions);
  const cov = coverage(inv, eff);
  const diffs = computeDiffs(a, decisions, eff);
  const roots = rootsOf(a);
  const pending = pendingOf(a, decisions, diffs);
  const per = {};
  for (const n of roots) {
    const p = proposals[n.id];
    if (p.cls === "structure" || p.delegate) continue; // a row or a wrapper follows the list element: one suggestion, not three
    per[p.cls] ??= { strong: 0, weak: 0 };
    per[p.cls][p.strength]++;
  }
  const strongPending = pending.filter((n) => proposals[n.id].strength === "strong" && proposals[n.id].cls !== "unsure");
  const violations = a.safe("violations", () => buildViolations(a, decisions), []);
  const markedPath = path.join(ref.dir, ref.marked);
  let marked = { name: ref.marked, exists: false, upToDate: false };
  try {
    const cur = fs.readFileSync(markedPath, "utf8");
    marked = { name: ref.marked, exists: true, upToDate: cur === applyDecisions(a, decisions).source };
  } catch {}
  return {
    v: 1,
    page: { mode: ref.mode, example: ref.example, file: ref.mode === "file" ? ref.pageFile : null, name: ref.name, ext: ref.ext, lines: source.split("\n").length, engine: ENGINE, canUse: ref.mode === "example" },
    files: { sidecar: filesFor(ref.key).json, history: filesFor(ref.key).history, marked: ref.marked },
    source,
    nodes: inv.nodes.filter((n) => n.id !== "root").map(strip),
    rootChildren: cx.cv.root,
    cv: cx.cv,
    groups: cx.groups.map((g) => ({ id: g.id, parent: g.parent, template: g.template, members: g.members, count: g.count, mapped: g.mapped, slots: g.slots.filter((s) => s.varies).map(({ path: p, type, prop, examples }) => ({ path: p, type, ...(prop ? { prop } : {}), examples })) })),
    follow: a.follow,
    components: cx.components,
    stats: cx.stats,
    proposals,
    decisions,
    effective: eff,
    coverage: cov,
    diffs,
    issues,
    summary: { violations: summarizeViolations(violations), states: a.states.length, interactions: a.interactions.reduce((m, i) => ((m[i.resolution] = (m[i.resolution] ?? 0) + 1), m), {}), interactionCoverage: interactionCoverage(a.interactions), proposed: pending.length, strong: strongPending.length, weak: pending.length - strongPending.length, perClass: per, decided: Object.keys(decisions).length, orphans },
    classes: CLASS_LABELS,
    history: summary(ref.dir, ref.key),
    contract: a.contract ? { present: true, file: a.contract.file, fields: a.contract.fields } : { present: false },
    states: a.states.map((s) => ({ ...s, status: decisions[s.id] ? (decisions[s.id].act === "reject" ? "dismissed" : "accepted") : "proposed" })),
    interactions: a.interactions,
    mappings: a.mappings,
    violations,
    warnings: a.warnings,
    marked,
    wireframe: wireframe(inv),
  };
}

/** Undo or redo the newest change. */
export function stepHistory(a, dirn) {
  const r = (dirn === "undo" ? undo : redo)(a.ref.dir, a.ref.key, a.ref.pageFile);
  if (r.error) throw new PagemapError(r.conflict ? 409 : 422, r.error);
  persistViolations(a);
  return r;
}

/**
 * Write the marked copy next to the source (example) or into the example's folder (a real page). Never the page itself.
 *
 * @param {ReturnType<typeof analyse>} a The analysis.
 * @returns {{written:string, edits:number, skipped:object[], diff:object}} What was written and how it differs from the source.
 * @throws {PagemapError} 422 when no decision writes anything.
 */
export function applyToCopy(a) {
  const decisions = liveDecisions(a).live;
  const out = applyDecisions(a, decisions);
  if (!out.edits.length) throw new PagemapError(422, "No accepted decision writes anything yet: accept a proposal first.", { skipped: out.skipped });
  const file = path.join(a.ref.dir, a.ref.marked);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out.source);
  fs.renameSync(tmp, file);
  return { written: a.ref.marked, edits: out.edits.length, skipped: out.skipped, diff: diffFile(a.source, out.source) };
}

/**
 * Second, explicit step: make the marked copy the page. Only for an example's own page, and only when the marked copy on disk
 * is exactly what the current decisions produce (so a stale copy can never replace the page). Keeps the page it replaces as a
 * backup that is never overwritten (`<page>.before-pagemap<ext>`, then `.2`, `.3`, ...) and starts the decisions over (positions change).
 *
 * @param {ReturnType<typeof analyse>} a The analysis.
 * @returns {{used:string, backup:string|null, unchanged?:true}} The page file replaced and the backup written; `unchanged` when the page already is the marked copy (no backup).
 * @throws {PagemapError} 400 when not an example page, 409 when the copy is missing or stale.
 */
export function useAsPage(a) {
  if (a.ref.mode !== "example") throw new PagemapError(400, "A real Subframe page is never replaced from here; use the marked copy.");
  const decisions = liveDecisions(a).live;
  const want = applyDecisions(a, decisions).source;
  const file = path.join(a.ref.dir, a.ref.marked);
  let have = null;
  try { have = fs.readFileSync(file, "utf8"); } catch {}
  if (have === null) throw new PagemapError(409, "There is no marked copy yet: apply to a marked copy first.");
  // Idempotent: the page already IS the marked copy and nothing decided would change it: nothing to replace, no new backup.
  if (have === a.source && want === a.source) return { used: a.ref.pageFile, backup: null, unchanged: true };
  if (have !== want) throw new PagemapError(409, "The marked copy is out of date (decisions changed since): apply to a marked copy again, then use it.");
  // The FIRST original is never overwritten: it stays `<page>.before-pagemap<ext>`; a later use keeps the page it replaces as
  // `<page>.before-pagemap.2<ext>`, `.3`, ... The name is claimed with an exclusive create (O_EXCL: it fails on ANY existing entry,
  // a dangling symlink included, and never writes through a symlink), and on EEXIST the next number is tried (50 tries at most), so
  // two requests that pick the same name cannot both get it. Undo: copy a backup over the page.
  const stem = path.basename(a.ref.pageFile, a.ref.ext);
  let backup = null;
  for (let i = 1; i <= MAX_BACKUPS && !backup; i++) {
    const name = i === 1 ? `${stem}.before-pagemap${a.ref.ext}` : `${stem}.before-pagemap.${i}${a.ref.ext}`;
    try { fs.writeFileSync(path.join(a.ref.dir, name), a.source, { flag: "wx" }); backup = name; } catch (e) {
      if (e.code === "EEXIST") continue;
      throw new PagemapError(503, `The backup could not be written (${e.code ?? "error"}); the page was not replaced.`);
    }
  }
  if (!backup) throw new PagemapError(409, `Could not get a backup name: ${MAX_BACKUPS} backups exist already. Move some away and try again; the page was not replaced.`);
  const tmp = `${a.ref.pagePath}.${process.pid}.${++tmpSeq}.tmp`;
  try { fs.writeFileSync(tmp, have, { flag: "wx" }); fs.renameSync(tmp, a.ref.pagePath); } catch (e) { fs.rmSync(tmp, { force: true }); throw new PagemapError(503, `The page could not be replaced (${e.code ?? "error"}); the backup ${backup} is kept.`); }
  fs.rmSync(path.join(a.ref.dir, filesFor(a.ref.key).json), { force: true });
  return { used: a.ref.pageFile, backup };
}

export { CLASS_KEYS, effectiveOf };
