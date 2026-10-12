// "What Line knows", the server side of the page (contract.mjs): the graph read from G1 (graph/build.mjs, cached by
// file hash), plus the Memory, Change and How smart is it providers, each in its own module (memory.mjs, changes.mjs,
// stats.mjs) so each tab's branch changes only its own file.
import { buildLineGraph } from '../graph/build.mjs';
import { graphRead } from './mock.mjs';
import { memoryServiceFor } from './memory.mjs';
import { proposeChanges } from './changes.mjs';
import { smartView } from './stats.mjs';

/**
 * The page's service for one project. `write` stores the graph under the project's Line state (through the writer);
 * off, the graph is built in memory on each read.
 * @param {{root: string, write?: boolean}} o
 * @returns The service the routes call.
 */
export function createKnowsService({ root, write = false }) {
  const graph = () => buildLineGraph(root, { write }).graph;
  return {
    graph: (/** @type {string|undefined} */ focus) => graphRead(graph(), focus),
    changes: () => proposeChanges(root, graph()),
    stats: () => smartView(root, graph()),
    ...memoryServiceFor(root),
  };
}
