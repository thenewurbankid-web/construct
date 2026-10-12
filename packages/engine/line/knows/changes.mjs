// "What Line knows", Change tab's server side (owned by the Change tab's branch, cloud-knows-change): the typed changes
// the graph proposes. Each one is a plan step (knows/contract.mjs CHANGE_TOOL) a person approves; nothing here writes.
import { MOCK_CHANGE_VIEW } from './mock.mjs';

/**
 * The changes the graph proposes (contract stub: the mock's, kept only while their finding is still in the graph).
 * @param {string} _root
 * @param {import('../graph/contract.mjs').LineGraph} graph
 * @returns {import('./contract.mjs').ChangeView}
 */
export function proposeChanges(_root, graph) {
  const open = new Set(graph.nodes.filter((n) => n.kind === 'finding').map((n) => n.id));
  const proposals = MOCK_CHANGE_VIEW.proposals.filter((p) => !p.finding || open.has(p.finding));
  return { ok: true, proposals, sentence: proposals.length ? `Line proposes ${proposals.length} change${proposals.length === 1 ? '' : 's'}; each one waits for your approval and goes through Construct's writer.` : 'Line has no change to propose.' };
}
