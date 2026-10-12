// "What Line knows", the Change tab's proposals (pure, no Node imports: the server and the client's mock mode share it).
// Each proposal is a plan step (contract.mjs CHANGE_TOOL) a person approves and Construct's writer lands.
//
// Where they come from (nothing is guessed that Construct does not already know):
//   a finding's own typed fixes (validate's view, model.mjs readLineProject)  line.promote -> promote,
//                                                                             line.setBase -> rebase,
//                                                                             any other    -> removeCrossUse (line.fix)
//   the item in focus (a feature item)   promote it to the library (line.promote), and re-base it on a library item of
//                                        its own kind that it already uses but is not based on (line.setBase)
import { CHANGE_TOOL } from './contract.mjs';

/** @typedef {import('./contract.mjs').ChangeProposal} ChangeProposal */
/** @typedef {import('../graph/contract.mjs').LineGraph} LineGraph */
/** @typedef {{key: string, rule: string, file: string, line: number, fixes?: {id: string, sentence: string, step?: {tool: string, args?: Record<string, unknown>}}[]}} FindingWithFixes */

const KIND_OF_TOOL = /** @type {Record<string, import('./contract.mjs').ChangeKind>} */ ({ 'line.promote': 'promote', 'line.setBase': 'rebase' });
const argsLine = (args) => Object.entries(args).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
const sentence = (s) => { const t = String(s).trim(); return /[.?!]$/.test(t) ? t : `${t}.`; };

/**
 * The proposals from findings' typed fixes, then from the item in focus.
 * @param {{findings?: FindingWithFixes[]}} project
 * @param {LineGraph} graph
 * @param {string} [focus]
 * @returns {ChangeProposal[]}
 */
export function changeProposals(project, graph, focus) {
  /** @type {ChangeProposal[]} */
  const out = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const itemOfFile = new Map(graph.nodes.filter((n) => n.kind === 'item' && n.file).map((n) => [n.file, n.id]));
  const add = (/** @type {ChangeProposal} */ p) => { if (!out.some((x) => x.kind === p.kind && JSON.stringify(x.step) === JSON.stringify(p.step))) out.push(p); };
  for (const f of project.findings ?? []) {
    const findingId = `finding:${f.key}`;
    for (const fix of f.fixes ?? []) {
      if (!fix.step) continue;
      const direct = KIND_OF_TOOL[fix.step.tool];
      const kind = direct ?? 'removeCrossUse';
      const args = direct ? { ...(fix.step.args ?? {}) } : { findingKey: f.key, fixId: fix.id };
      const target = fix.step.tool === 'line.promote' ? `item:${args.featureItemId}` : (itemOfFile.get(f.file) ?? findingId);
      add({ id: `change:${f.key}:${fix.id}`, kind, target, finding: findingId, sentence: sentence(fix.sentence), step: { tool: CHANGE_TOOL[kind], args }, details: [`${CHANGE_TOOL[kind]} ${argsLine(args)}`, `fixes ${f.rule} ${f.file}:${f.line}`] });
    }
  }
  const n = focus ? nodes.get(focus) : undefined;
  if (n && n.kind === 'item' && n.attrs?.area === 'feature') {
    const id = n.id.slice('item:'.length);
    add({ id: `change:promote:${id}`, kind: 'promote', target: n.id, sentence: `Move ${n.label} from feature ${n.attrs.feature} into the library and point every import at the library copy.`, step: { tool: 'line.promote', args: { featureItemId: id } }, details: [`line.promote featureItemId=${id}`] });
    const base = graph.edges.find((e) => e.from === n.id && e.type === 'BASED_ON')?.to;
    const used = graph.edges.filter((e) => e.from === n.id && e.type === 'IMPORTS' && e.to !== base).map((e) => nodes.get(e.to)).filter((m) => m && m.attrs?.area === 'library' && m.attrs?.itemKind === n.attrs?.itemKind);
    for (const m of used) {
      const libraryId = /** @type {any} */ (m).id.slice('item:library/'.length);
      add({ id: `change:rebase:${id}:${libraryId}`, kind: 'rebase', target: n.id, sentence: `Base ${n.label} on the library ${/** @type {any} */ (m).label}, which it already uses.`, step: { tool: 'line.setBase', args: { file: n.file, libraryId } }, details: [`line.setBase file=${n.file} libraryId=${libraryId}`] });
    }
  }
  // The item in focus first.
  return focus ? [...out.filter((p) => p.target === focus), ...out.filter((p) => p.target !== focus)] : out;
}

/**
 * The ChangeView of a list of proposals.
 * @param {ChangeProposal[]} proposals
 * @returns {import('./contract.mjs').ChangeView}
 */
export function changeView(proposals) {
  return { ok: true, proposals, sentence: proposals.length ? `Line proposes ${proposals.length} change${proposals.length === 1 ? '' : 's'}; each one waits for your approval and goes through Construct's writer.` : 'Line has no change to propose.' };
}
