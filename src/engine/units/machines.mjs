// Workflow machines of a set of workflow-layer files, narrated in plain English by the existing
// extractor/narrator/scenario blocks (src/engine/workflow*.mjs). Deterministic, read-only.
import fs from 'node:fs';
import path from 'node:path';
import { explainSource } from '../workflowExplain.mjs';

/** @returns {{file:string, machine:string, summary:string, states:number, findings:{severity:string,message:string}[], error?:string}[]} */
export function machinesOf(ctx, files, { withStates = false } = {}) {
  const out = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(path.join(ctx.root, file), 'utf8'); } catch { continue; }
    if (!/createMachine|setup\(|xstate/.test(src)) continue;
    const { machines, error } = explainSource(src);
    if (error) out.push({ file, machine: path.basename(file), summary: `Could not read machines: ${error}`, states: 0, findings: [], error: String(error) });
    for (const m of machines) {
      out.push({
        file, machine: m.machine, summary: m.summary, states: m.states.length,
        findings: (m.findings || []).map((f) => ({ severity: f.severity, message: f.message })),
        ...(withStates ? { stateSentences: m.states.map((s) => ({ state: s.label, kind: s.kind, sentences: s.sentences })) } : {}),
      });
    }
  }
  return out;
}
