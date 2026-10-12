// "What Line knows", the Change tab's server side: the typed changes the graph proposes for a project
// (proposals.mjs, over validate's findings and their typed fixes). Nothing here writes: each change is a plan step.
import { readLineProject } from '../model.mjs';
import { changeProposals, changeView } from './proposals.mjs';

/**
 * The changes the graph proposes for a project.
 * @param {string} root
 * @param {import('../graph/contract.mjs').LineGraph} graph
 * @param {string} [focus]
 * @returns {import('./contract.mjs').ChangeView}
 */
export function proposeChanges(root, graph, focus) {
  return changeView(changeProposals(readLineProject(root), graph, focus));
}
