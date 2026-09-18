// Ticket 7.1 -- Context Envelope pipeline runner.
//
// `runPipeline(root, inputEnvelope)` is the pure orchestration behind
// `construct pipeline run`: it renders every requested step's generated file
// content (via generators.mjs's renderLayer -- no disk write yet), stages
// all of them in one transactionalWriter transaction, and commits once.
// Either every step's file lands on disk together, or (if the combined
// result fails construct validate's own enforcer set) none of them do --
// there is no partially-applied pipeline run.
import { renderLayer } from '../generators.mjs';
import { aggregateValidation } from '../registry.mjs';
import { createTransaction } from './transactionalWriter.mjs';
import { createEnvelope } from './envelope.mjs';
import { rel } from '../fs.mjs';
import { DEFAULT_ENFORCERS } from './defaultEnforcers.mjs';

/** Merge freshly-committed step outputs into the envelope's `layers` map:
 * { layer: [file, file, ...] }, deduped, sorted for deterministic output. */
function mergeLayers(existingLayers, committedByLayer) {
  const merged = { ...existingLayers };
  for (const [layer, files] of Object.entries(committedByLayer)) {
    const prior = merged[layer] || [];
    merged[layer] = [...new Set([...prior, ...files])].sort();
  }
  return merged;
}

/**
 * @param {string} root - project root.
 * @param {object} inputEnvelope - a Context Envelope, optionally carrying a
 *   `steps: [{layer, name}, ...]` list of generator steps to run against
 *   `inputEnvelope.feature`. Already schema-validated by the caller
 *   (src/cli.mjs's `pipeline` command uses envelope.mjs's validateEnvelope).
 * @returns {object} the resulting Context Envelope (`status`: 'committed' |
 *   'aborted', `steps` always cleared, `layers`/`diagnostics` updated).
 */
export function runPipeline(root, inputEnvelope) {
  const feature = inputEnvelope.feature;
  const steps = inputEnvelope.steps || [];
  const txn = createTransaction(root);
  const renderedByLayer = {};

  for (const step of steps) {
    const { file, content } = renderLayer(root, step.layer, step.name, feature);
    const relPath = rel(root, file);
    txn.writeFile(relPath, content);
    (renderedByLayer[step.layer] ||= []).push(relPath);
  }

  const { committed, violations } = txn.commit({
    validate: (shadowRoot) => aggregateValidation(shadowRoot, DEFAULT_ENFORCERS),
  });

  const base = createEnvelope(feature, {
    unboundSlots: inputEnvelope.unboundSlots || [],
    events: inputEnvelope.events || [],
    layers: inputEnvelope.layers || {},
  });

  if (committed) {
    return {
      ...base,
      status: 'committed',
      layers: mergeLayers(base.layers, renderedByLayer),
      diagnostics: [],
    };
  }
  return {
    ...base,
    status: 'aborted',
    diagnostics: violations,
  };
}
