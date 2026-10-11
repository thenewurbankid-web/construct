// Expressions (System 1 groundwork) -- the facts mock: a LineFacts snapshot (contract.mjs) of the mock project
// (mock.mjs), so an expression, a tool's pre/post or a training record can be built and tested without a real project.
import crypto from 'node:crypto';
import { createMockLineOps } from './mock.mjs';
import { projectFacts } from './facts.mjs';
import { structureOf } from './structure.mjs';

/**
 * The mock project's facts. Plain JSON (not lazy); pass `ops` to snapshot a mock you changed.
 * @param {{ops?: ReturnType<typeof createMockLineOps>, plan?: any, findingsNew?: any[]}} [o]
 * @returns {import('./contract.mjs').LineFacts}
 */
export function mockFacts({ ops = createMockLineOps(), plan = null, findingsNew = [] } = {}) {
  const project = ops.readLineProject('/mock');
  const pf = projectFacts(project);
  /** @type {Record<string, {bytes: number, hash: string}>} */
  const files = {};
  for (const [p, src] of Object.entries(ops.files()).sort(([a], [b]) => (a < b ? -1 : 1))) files[p] = { bytes: Buffer.byteLength(src), hash: crypto.createHash('sha256').update(src).digest('hex') };
  return { files, library: pf.library, features: pf.features, findings: pf.findings, findingsNew, plan, structure: structureOf(project), truncated: { files: 0, findings: pf.truncatedFindings } };
}
