// Ticket 7.1 -- Context Envelope helpers.
//
// A Context Envelope is the plain-JSON state object passed between pipeline
// steps (see schemas/envelope.v1.json for the full documented shape and
// pipeline.mjs for how `construct pipeline run` produces/consumes one). This
// module owns constructing a well-formed envelope and validating one against
// the schema's required shape.
//
// No JSON-Schema-engine dependency (e.g. ajv) is added for this: the schema
// in schemas/envelope.v1.json is the documentation of record, and this is a
// small, hand-written structural validator that enforces the same
// requirements. envelope.test.mjs asserts the two stay in lockstep (the
// schema's own `required` array is read directly, not hand-copied) so drift
// between them fails a test instead of silently diverging.

export const ENVELOPE_VERSION = 1;
const VALID_STATUS = new Set(['pending', 'committed', 'aborted']);
const VALID_SLOT_KINDS = new Set(['callback', 'value']);

/** Build a fresh, valid v1 envelope for `feature`, optionally seeded with
 * prior state (e.g. the previous pipeline step's output envelope). */
export function createEnvelope(feature, overrides = {}) {
  return {
    version: ENVELOPE_VERSION,
    feature,
    status: 'pending',
    layers: {},
    unboundSlots: [],
    events: [],
    diagnostics: [],
    ...overrides,
  };
}

function fail(errors, message) {
  errors.push(message);
}

/**
 * Structural validation against schemas/envelope.v1.json's shape. Returns
 * `{ valid, errors }` rather than throwing, so a caller (e.g. `construct
 * pipeline run` reading a malformed envelope off stdin) can report every
 * problem at once instead of stopping at the first.
 *
 * @param {any} envelope Parsed Context Envelope.
 * @returns {{valid:boolean, errors:string[]}} Every structural problem found, not just the first.
 *
 * @example
 * validateEnvelope({ version: 1, feature: 'billing', status: 'pending', layers: [] });
 */
export function validateEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['Envelope must be a JSON object.'] };
  }

  for (const key of ['version', 'feature', 'status', 'layers']) {
    if (!(key in envelope)) fail(errors, `Missing required field "${key}".`);
  }
  if (envelope.version !== undefined && envelope.version !== ENVELOPE_VERSION) {
    fail(errors, `"version" must be ${ENVELOPE_VERSION} (got ${JSON.stringify(envelope.version)}).`);
  }
  if (envelope.feature !== undefined && (typeof envelope.feature !== 'string' || !envelope.feature)) {
    fail(errors, '"feature" must be a non-empty string.');
  }
  if (envelope.status !== undefined && !VALID_STATUS.has(envelope.status)) {
    fail(errors, `"status" must be one of: ${[...VALID_STATUS].join(', ')} (got ${JSON.stringify(envelope.status)}).`);
  }
  if (envelope.layers !== undefined) {
    if (!envelope.layers || typeof envelope.layers !== 'object' || Array.isArray(envelope.layers)) {
      fail(errors, '"layers" must be an object mapping layer name -> file path array.');
    } else {
      for (const [layer, files] of Object.entries(envelope.layers)) {
        if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) {
          fail(errors, `"layers.${layer}" must be an array of file path strings.`);
        }
      }
    }
  }
  if (envelope.unboundSlots !== undefined) {
    if (!Array.isArray(envelope.unboundSlots)) {
      fail(errors, '"unboundSlots" must be an array.');
    } else {
      envelope.unboundSlots.forEach((slot, i) => {
        if (!slot || typeof slot.name !== 'string' || !slot.name) fail(errors, `unboundSlots[${i}] is missing a "name" string.`);
        if (!slot || !VALID_SLOT_KINDS.has(slot.kind)) fail(errors, `unboundSlots[${i}].kind must be "callback" or "value".`);
      });
    }
  }
  if (envelope.events !== undefined) {
    if (!Array.isArray(envelope.events)) {
      fail(errors, '"events" must be an array.');
    } else {
      envelope.events.forEach((ev, i) => {
        if (!ev || typeof ev.type !== 'string' || !ev.type) fail(errors, `events[${i}] is missing a "type" string.`);
      });
    }
  }
  if (envelope.diagnostics !== undefined && !Array.isArray(envelope.diagnostics)) {
    fail(errors, '"diagnostics" must be an array.');
  }
  if (envelope.steps !== undefined) {
    if (!Array.isArray(envelope.steps)) {
      fail(errors, '"steps" must be an array.');
    } else {
      envelope.steps.forEach((step, i) => {
        if (!step || typeof step.layer !== 'string' || !step.layer) fail(errors, `steps[${i}] is missing a "layer" string.`);
        if (!step || typeof step.name !== 'string' || !step.name) fail(errors, `steps[${i}] is missing a "name" string.`);
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
