// T12.1: interactive AI sample generation for a contract field that has no example at all (openapi.mjs's
// "field-no-example" gap). This is a small, single-turn, CHECKED task like the others in this folder (see this
// file's header for the family): the model proposes ONE plausible value for display, and it is accepted only
// when it is a single JSON scalar (string/number/boolean) matching the field's declared type when one is known.
//
// This never writes to the contract file and never reaches the matcher (src/match.mjs) or the eval corpus: it
// only fills in a "synthetic" label shown next to the gap in the Contract card, so a wrong or bland guess costs
// nothing but re-generating it. Per CLAUDE.md's Qwen policy ("a use needs a verifier ... or it stays off or only
// proposes"), a use that only proposes needs no accuracy measurement — this one never picks or decides
// anything, so it carries none, and this file does not add an eval variant (see the T12 builder report for why
// one would be meaningless here: eval/ scores match/ask/accept outcomes, and this never produces one).
const SYSTEM = 'You invent ONE plausible sample value for a single API field, for a mock/demo — never a real answer, just a believable placeholder. Reply with JSON only: {"value": <the value>}. The value must be a single string, number or boolean — never an object, an array, or null.';

/**
 * Build the small prompt for one field.
 *
 * @param {{endpoint: string, where: "request"|"response", field: string, type?: string, siblings?: object}} req
 *   `endpoint` is `"METHOD /path"`; `type` is a declared JS type when known (request fields only; see
 *   openapi.mjs's `declared`); `siblings` is the rest of the same record's known (real) values, for context.
 * @returns {string}
 */
export function samplePrompt({ endpoint, where, field, type, siblings = {} }) {
  const sib = Object.entries(siblings ?? {}).filter(([, v]) => v !== null && typeof v !== "object").slice(0, 6).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  return `Endpoint: ${endpoint}\nField (${where}): "${field}"${type ? ` — declared type: ${type}` : ""}` +
    `${sib ? `\nOther fields already on the same record, for context and tone: ${sib}` : ""}\nReply: {"value": <a plausible sample>}`;
}

/**
 * Verify a raw model reply: valid JSON holding `{"value": <scalar>}`. When `type` is given (a request field's
 * declared type), `typeof value` must match it; otherwise (a response field — openapi.mjs tracks no declared
 * type for those) any scalar is accepted. Never accepts `null`, an object or an array.
 *
 * @param {string} text The model's raw reply.
 * @param {"string"|"number"|"boolean"|"object"} [type] A declared JS type to check against, when known.
 * @returns {{ok: true, value: string|number|boolean}|{ok: false, why: string}}
 */
export function checkSample(text, type) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? "").match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return { ok: false, why: "the reply was not valid JSON" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("value" in parsed)) return { ok: false, why: 'the reply had no "value"' };
  const v = parsed.value;
  if (v === null || typeof v === "object") return { ok: false, why: "the value was not a single string, number or boolean" };
  if ((type === "number" || type === "boolean" || type === "string") && typeof v !== type) return { ok: false, why: `expected a ${type}, got ${typeof v}` };
  return { ok: true, value: v };
}

/**
 * Propose one sample value for a field: builds the prompt, calls `providerFn` (the shape `makeProvider()`
 * returns — `({system, user, schema, maxTokens}) => Promise<{text, usage, thinking?}>`), and checks the reply.
 *
 * @param {{endpoint: string, where: "request"|"response", field: string, type?: string, siblings?: object}} req
 * @param {(args: {system: string, user: string, schema: object, maxTokens: number}) => Promise<{text: string}>} providerFn
 * @returns {Promise<{ok: true, value: *}|{ok: false, why: string}>}
 */
export async function proposeSample(req, providerFn) {
  const user = samplePrompt(req);
  const schema = { type: "object", properties: { value: {} }, required: ["value"] };
  let reply;
  try { reply = await providerFn({ system: SYSTEM, user, schema, maxTokens: 60 }); } catch (e) { return { ok: false, why: `the model call failed: ${e.message}` }; }
  return checkSample(reply?.text, req.type);
}
