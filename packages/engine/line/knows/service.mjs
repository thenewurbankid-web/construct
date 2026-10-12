// "What Line knows", the server side of the page (contract.mjs): the graph read from G1 (graph/build.mjs, cached by
// file hash), plus the Memory, Change and How smart is it providers, each in its own module (memory.mjs, changes.mjs,
// stats.mjs) so each tab's branch changes only its own file.
import fs from 'node:fs';
import path from 'node:path';
import { buildLineGraph, graphSources } from '../graph/build.mjs';
import { lineStateDir } from '../workspace.mjs';
import { graphRead } from './mock.mjs';
import { memoryServiceFor } from './memory.mjs';
import { proposeChanges } from './changes.mjs';
import { smartView } from './stats.mjs';

/** How long one built graph answers the page's reads (a tab opening reads the graph and its changes together). */
const FRESH_MS = 1500;

/**
 * A cheap stamp of what the graph is built from (each source file's and plan file's size and mtime): a write inside
 * FRESH_MS, e.g. an approved promote, must not answer the next read with the graph from before it.
 * @param {string} root
 * @returns {string}
 */
function inputsStamp(root) {
  const plans = `${lineStateDir(root)}/plans`;
  let planFiles = [];
  try { planFiles = fs.readdirSync(path.join(root, plans)).filter((n) => n.endsWith('.json')).sort().map((n) => `${plans}/${n}`); } catch { /* no plans */ }
  return [...graphSources(root).files, ...planFiles].map((f) => {
    try { const st = fs.statSync(path.join(root, f)); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return `${f}:-`; }
  }).join('\n');
}

/**
 * The page's service for one project. `write` stores the graph under the project's Line state (through the writer), so
 * a later read with no file changed analyses nothing; off, the graph is built in memory.
 * @param {{root: string, write?: boolean}} o
 * @returns The service the routes call.
 */
export function createKnowsService({ root, write = false }) {
  /** @type {{at: number, stamp: string, graph: import('../graph/contract.mjs').LineGraph} | null} */
  let last = null;
  const graph = () => {
    const stamp = inputsStamp(root);
    if (last && Date.now() - last.at < FRESH_MS && last.stamp === stamp) return last.graph;
    last = { at: Date.now(), stamp, graph: buildLineGraph(root, { write }).graph };
    return last.graph;
  };
  return {
    graph: (/** @type {string|undefined} */ focus) => graphRead(graph(), focus),
    changes: (/** @type {string|undefined} */ focus) => proposeChanges(root, graph(), focus),
    stats: () => smartView(root, graph()),
    ...memoryServiceFor(root),
  };
}
