// #948 -- modelled model I/O: the one switch and the shared vocabulary. Every product model call is modelled: a fixed
// input (one unit's facts), a constrained output (a prefilled signature that stops at the closing brace for code; a
// closed enum or a small JSON schema for a choice; never code inside JSON), one function or one decision per request,
// and a deterministic check that rejects with a concrete example. The modelled path is the default; the old
// free-form path stays behind LINE_LEGACY_IO=1 for one release. The prefill mechanics are in
// packages/engine/line/coder/prefill/.

/** The environment switch that brings back the old free-form exchanges (one release). */
export const LEGACY_IO_ENV = 'LINE_LEGACY_IO';

/**
 * True when the old free-form path is switched on (LINE_LEGACY_IO=1).
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export const legacyIo = (env = process.env) => env[LEGACY_IO_ENV] === '1';

/** Plan tools whose arguments carry code: never repaired or offered as JSON on the modelled path. */
export const CODE_TOOLS = Object.freeze(['line.setCode', 'line.setFragment']);

/**
 * Whether a plan tool's arguments carry code.
 * @param {string} tool
 * @returns {boolean}
 */
export const isCodeTool = (tool) => CODE_TOOLS.includes(String(tool));

/** Argument names that carry code in a tool's JSON Schema. */
export const CODE_ARG_NAMES = Object.freeze(['code', 'content', 'body', 'source']);

/**
 * A choice reply's concrete example, for a refusal: one JSON object with the closed fields only.
 * @param {any} example
 * @returns {string}
 */
export const choiceExample = (example) => `A valid reply is exactly one JSON object, for example ${JSON.stringify(example)}.`;
