// #938 (part of #934): make local Ollama models good at PICKING the right tool, with Ollama's native tool calling only
// (the `tools` param in, `message.tool_calls` out). No call is ever parsed out of text: a text answer, or a call of a
// tool that was not offered, is answered next turn with one line naming the same small tool set (`nudge`).
//
//   callNative({model, messages, tools, ...})   one /api/chat with `tools`; the native calls (arguments as objects),
//                                               split into `calls` (offered) and `wrong` (not offered)
//   nudge(result, tools)                        the one-line reply when the model wrote text or called the wrong tool
//   checkArgs(tool, args, {check})              L3: the arguments against the tool's JSON Schema plus a caller check
//                                               (path exists, path in scope); a refusal with an example of a correct call
//   layeredTurn({...})                          L1 decide -> L2 call -> L3 check -> L4 record, each a fresh small context
//
// Layered turn: L1 asks "what do you need next?" with Ollama `format` = an enum of short intent sentences (one per
// offered tool, plus "Write the code for this step" and "Ask a question"); Line maps the sentence to a tool. Only the
// choice is forced: L2 is a native call offering ONLY that tool (retried once when no call comes back, then a miss).
// L3 validates; a failure repeats L2 with the refusal, never L1. L4 boils the result down to one ledger sentence.
//
// Engine code takes no JSON-Schema dependency at runtime (packages/engine/envelope.mjs does the same), so `validate`
// is a small validator for the subset tool schemas use: type, properties, required, additionalProperties, enum, const,
// items, oneOf/anyOf.

export const WRITE_CODE = 'Write the code for this step';
export const ASK = 'Ask a question';

const safeParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
export const toolName = (t) => t?.function?.name ?? t?.name;
const toolSchema = (t) => t?.function?.parameters ?? { type: 'object', properties: {} };

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const typeOk = (want, v) => { const t = typeOf(v); return want === t || (want === 'number' && t === 'integer'); };

/**
 * Validate `value` against `schema` (the subset above). Unknown keywords are ignored.
 * @param {any} schema @param {any} value @param {string} [at] The path printed in messages.
 * @returns {{path: string, message: string}[]}
 */
export function validate(schema, value, at = 'arguments') {
  if (!schema || typeof schema !== 'object') return [];
  /** @type {{path: string, message: string}[]} */
  const errs = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, value))) return [{ path: at, message: `${at} must be ${types.join(' or ')}, not ${typeOf(value)}` }];
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errs.push({ path: at, message: `${at} must be ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push({ path: at, message: `${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  for (const key of ['oneOf', 'anyOf']) {
    if (!Array.isArray(schema[key])) continue;
    const passing = schema[key].filter((s) => validate(s, value, at).length === 0).length;
    if (key === 'oneOf' ? passing !== 1 : passing === 0) errs.push({ path: at, message: `${at} matches ${passing} of the ${key} choices` });
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties ?? {};
    for (const r of schema.required ?? []) if (value[r] === undefined) errs.push({ path: `${at}.${r}`, message: `${at}.${r} is required` });
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push({ path: `${at}.${k}`, message: `${at}.${k} is not an argument of this tool` });
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${at}[${i}]`)));
  return errs;
}

/** One example value that validates against `schema` (required properties only), for a refusal's "A correct call". */
export function exampleOf(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return exampleOf(schema.oneOf[0]);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return exampleOf(schema.anyOf[0]);
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === 'string') { const m = /e\.g\.\s*("?)([^",)]+)\1/.exec(String(schema.description ?? '')); return m ? m[2].trim() : '...'; }
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return true;
  if (t === 'array') return [];
  if (t === 'null') return null;
  return Object.fromEntries((schema.required ?? []).map((k) => [k, exampleOf(schema.properties?.[k])]));
}

/**
 * L3: the arguments of a native call against its tool's schema, then `check(name, args)` (the caller's own: the path
 * exists, the path is in scope; returns an error sentence or null). Null when the call is fine, else a refusal in the
 * house shape ({ok: false, code: 'BAD_ARGS', sentence}) ending with an example of a correct call.
 * @param {any} tool @param {any} args @param {{check?: (name: string, args: any) => string|null}} [o]
 */
export function checkArgs(tool, args, { check } = {}) {
  const name = toolName(tool);
  const errors = validate({ ...toolSchema(tool), type: 'object' }, args ?? {}).map((e) => e.message);
  if (!errors.length && check) { const e = check(name, args ?? {}); if (e) errors.push(e); }
  if (!errors.length) return null;
  const example = { ...exampleOf(toolSchema(tool)), ...(args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).filter(([k, v]) => validate(toolSchema(tool).properties?.[k], v).length === 0 && !errors.some((m) => m.includes(`.${k}`)))) : {}) };
  return { ok: false, code: 'BAD_ARGS', sentence: `Refused (BAD_ARGS): ${errors.join('; ')}.\nA correct call: ${name} ${JSON.stringify(example)}`, errors };
}

/**
 * One native /api/chat. `calls` are the offered tools' native calls (arguments parsed when Ollama sent a string);
 * `wrong` are native calls of tools that were not offered; content is never parsed.
 * @param {{model: string, messages: any[], tools: any[], options?: object, ollama?: string, fetch?: typeof fetch,
 *   signal?: AbortSignal, format?: any}} o
 * @returns {Promise<{request: any, response: any, message: any, calls: any[], wrong: any[]}>}
 *   Throws on a transport or HTTP error (`error.request`, and `error.response` when the body parsed).
 */
export async function callNative({ model, messages, tools, options, ollama = 'http://127.0.0.1:11434', fetch: doFetch = globalThis.fetch, signal, format }) {
  const request = { model, stream: false, messages, ...(tools?.length ? { tools } : {}), ...(format ? { format } : {}), ...(options ? { options } : {}) };
  /** @type {Response} */ let r;
  try { r = await doFetch(`${ollama}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), ...(signal ? { signal } : {}) }); } catch (e) { /** @type {any} */ (e).request = request; throw e; }
  const response = await r.json().catch(() => ({}));
  if (!r.ok) { const e = /** @type {any} */ (new Error(response?.error ?? `HTTP ${r.status}`)); e.response = response; e.request = request; throw e; }
  const message = response.message ?? { role: 'assistant', content: '' };
  const offered = new Set((tools ?? []).map(toolName));
  const all = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((c) => ({ function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? safeParse(c.function.arguments) ?? {} : c.function?.arguments ?? {} } }));
  return { request, response, message, calls: all.filter((c) => offered.has(c.function.name)), wrong: all.filter((c) => !offered.has(c.function.name)) };
}

/**
 * The one line the next turn starts with when this one produced no usable call (null when it did): the model wrote
 * text, or called a tool that was not offered. Either way it names the same small tool set.
 * @param {{calls: any[], wrong: any[]}} result @param {any[]} tools
 */
export function nudge(result, tools) {
  if (result.calls.length) return null;
  const names = tools.map(toolName).join(', ');
  if (result.wrong.length) return `${result.wrong.map((c) => c.function.name).join(', ')} is not a tool this turn; call one of: ${names}.`;
  return `You answered in text; call one of your tools: ${names}.`;
}

/** L1's format: the reply is exactly {"next": <one of the intent sentences>}. */
export const intentSchema = (sentences) => ({ type: 'object', properties: { next: { type: 'string', enum: sentences } }, required: ['next'] });

/** The default L4: one sentence for the ledger from a tool call and its answer. */
export function recordSentence(name, args, out) {
  const first = String(out?.sentence ?? '').split('\n').find((l) => l.trim()) ?? '';
  const what = args?.path ?? args?.file ?? args?.tool ?? '';
  return `${name}${what ? ` ${what}` : ''}: ${out?.ok === false ? `refused (${out.code ?? 'error'}) ` : ''}${first.slice(0, 200)}`;
}

/**
 * One layered coder turn. `decideMessages` and `callMessages(tool, refusal)` build the fresh, small contexts (for
 * example: a short decide prompt + the ledger view + the request; the cleaned builder prompt + the ledger view + the
 * request + "Call <tool> now."). `intents` maps each intent sentence to a tool name (null for "Ask a question").
 * `run(name, args)` runs the call (optional: without it L4 records the call only).
 * @param {{model: string, tools: any[], intents: Record<string, string|null>, decideMessages: any[],
 *   callMessages: (tool: any, refusal: any) => any[], check?: (name: string, args: any) => string|null,
 *   run?: (name: string, args: any) => Promise<any>, record?: (name: string, args: any, out: any) => string,
 *   options?: object, ollama?: string, fetch?: typeof fetch, signal?: AbortSignal}} o
 * @returns {Promise<{intent: string|null, tool: string|null, call: any|null, out: any, requests: number, native: boolean,
 *   valid: boolean, miss: boolean, refusals: any[], sentence: string}>}
 */
export async function layeredTurn({ model, tools, intents, decideMessages, callMessages, check, run, record = recordSentence, options, ollama, fetch: doFetch, signal }) {
  const sentences = Object.keys(intents);
  const net = { options, ollama, fetch: doFetch, signal };
  // L1 decide: only the choice is forced.
  const d = await callNative({ model, messages: decideMessages, tools: [], format: intentSchema(sentences), ...net });
  let requests = 1;
  const intent = safeParse(String(d.message.content ?? ''))?.next ?? null;
  const name = intent && Object.hasOwn(intents, intent) ? intents[intent] : null;
  const tool = tools.find((t) => toolName(t) === name) ?? null;
  if (!tool) return { intent, tool: null, call: null, out: null, requests, native: false, valid: false, miss: true, refusals: [], sentence: intent === ASK ? 'The coder asked a question instead of a step.' : `No tool for the intent ${JSON.stringify(intent)}.` };
  // L2 call (one retry when no call comes back) and L3 check (a failure repeats L2 with the refusal).
  /** @type {any[]} */ const refusals = [];
  let call = null; let native = false; let noCall = 0;
  while (requests < 6) {
    const h = await callNative({ model, messages: callMessages(tool, refusals[refusals.length - 1] ?? null), tools: [tool], ...net });
    requests += 1;
    const c = h.calls[0];
    if (!c) { noCall += 1; if (noCall >= 2) break; continue; }
    native = true;
    const bad = checkArgs(tool, c.function.arguments, { check });
    if (!bad) { call = c; break; }
    refusals.push(bad);
    if (refusals.length >= 2) break;
  }
  if (!call) return { intent, tool: name, call: null, out: refusals[refusals.length - 1] ?? null, requests, native, valid: false, miss: !native, refusals, sentence: native ? `${name}: the arguments were refused ${refusals.length} times.` : `${name}: no native call in ${noCall} tries (a miss).` };
  // L4 record.
  const out = run ? await run(name, call.function.arguments) : { ok: true, sentence: 'called' };
  return { intent, tool: name, call, out, requests, native: true, valid: true, miss: false, refusals, sentence: record(name, call.function.arguments, out) };
}
