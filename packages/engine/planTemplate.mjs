// #333 — plan templates: a NAMED, REUSABLE, PARAMETERISED plan.
//
// OPEN-CORE BOUNDARY. This file is the MECHANISM (open): the template shape,
// load-time validation, typed parameter validation, and `instantiate` -> an
// ordinary plan.v1 object. The CURATED SET of named flows is proprietary and
// must never live under src/ or be imported from here. Templates are loaded
// from a directory or registry the CALLER supplies (`loadTemplateDir`,
// `createTemplateRegistry`); this module has no default location.
//
// No second plan shape: a template instantiates INTO the plan of #286 and the
// result is checked with validatePlan(); planToCommand() is unchanged.
//
// Template (JSON):
//   { templateVersion: 1, name, description,
//     parameters: { <name>: { type: 'identifier'|'path'|'enum', description,
//                             example (required), values (enum only),
//                             required?, default? } },
//     ticket: { source, title, ref?, body? },
//     summary?, steps: [ plan.v1 steps, where any string may contain {{param}} ] }
//
// Safety: `{{param}}` is refused in a step's `id`, `flow`, `executor` and
// `dependsOn`: a parameter can never change WHICH flow a step runs, only fill
// argument slots (and titles/paths). Parameter values never start with "-",
// never contain NUL, `..` or an absolute path, so a value cannot become an
// extra flag; planToCommand pushes each value as one argv element (no shell),
// so it fills exactly one slot.
//
// Deterministic: no clock, no randomness, no filesystem in instantiate.
import fs from 'node:fs';
import path from 'node:path';
import { createPlan, validatePlan, formatPlanErrors, planFlow } from '../core/plan.mjs';

export const TEMPLATE_VERSION = 1;
export const PARAM_TYPES = Object.freeze(['identifier', 'path', 'enum']);

export const TEMPLATE_ERROR_CODES = Object.freeze({
  TEMPLATE_NOT_OBJECT: 'TEMPLATE_NOT_OBJECT',
  TEMPLATE_INVALID: 'TEMPLATE_INVALID',
  TEMPLATE_VERSION_INVALID: 'TEMPLATE_VERSION_INVALID',
  TEMPLATE_NAME_INVALID: 'TEMPLATE_NAME_INVALID',
  TEMPLATE_PARAM_INVALID: 'TEMPLATE_PARAM_INVALID',
  TEMPLATE_FLOW_UNKNOWN: 'TEMPLATE_FLOW_UNKNOWN',
  TEMPLATE_PARAM_UNDEFINED: 'TEMPLATE_PARAM_UNDEFINED',
  TEMPLATE_PLACEHOLDER_FORBIDDEN: 'TEMPLATE_PLACEHOLDER_FORBIDDEN',
  TEMPLATE_EXAMPLE_INVALID: 'TEMPLATE_EXAMPLE_INVALID',
  TEMPLATE_DUPLICATE: 'TEMPLATE_DUPLICATE',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  PARAM_MISSING: 'PARAM_MISSING',
  PARAM_UNKNOWN: 'PARAM_UNKNOWN',
  PARAM_TYPE: 'PARAM_TYPE',
  PARAM_INVALID: 'PARAM_INVALID',
  PARAM_ENUM: 'PARAM_ENUM',
});

/** A refusal with a stable, named code and structured `errors`. */
export class TemplateError extends Error {
  constructor(code, message, errors) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
    this.errors = errors || [{ code, path: '', message }];
  }
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_@][A-Za-z0-9._@-]*$/;
const NAME = /^[a-z][a-z0-9.-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g;
const BAD_PLACEHOLDER = /\{\{|\}\}/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Validate one parameter value against its declaration. Returns an error
 * `{ code, message }` or null. Pure. */
export function checkParamValue(spec, value) {
  if (typeof value !== 'string') return { code: TEMPLATE_ERROR_CODES.PARAM_TYPE, message: 'must be a string' };
  if (value.length === 0) return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: 'must not be empty' };
  if (value.includes('\0')) return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: 'must not contain a NUL byte' };
  if (spec.type === 'identifier') {
    if (!IDENTIFIER.test(value)) return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: `must be an identifier (${IDENTIFIER}), got ${JSON.stringify(value)}` };
    return null;
  }
  if (spec.type === 'enum') {
    if (!spec.values.includes(value)) return { code: TEMPLATE_ERROR_CODES.PARAM_ENUM, message: `must be one of: ${spec.values.join(', ')}` };
    return null;
  }
  // path: project-relative, forward slashes, no "..", no absolute, no leading "-"
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value) || path.isAbsolute(value)) {
    return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: 'must be project-relative, not absolute' };
  }
  for (const s of value.split('/')) {
    if (s === '..') return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: 'must not contain ".."' };
    if (!PATH_SEGMENT.test(s)) {
      return { code: TEMPLATE_ERROR_CODES.PARAM_INVALID, message: `has an unsafe path segment ${JSON.stringify(s)} (allowed: letters, digits, . _ @ -; no leading "-", no empty or "." segments)` };
    }
  }
  return null;
}

/** Validate supplied parameters against a loaded template and return the
 * resolved values (defaults applied). Throws TemplateError listing every
 * problem, by name. */
export function resolveParams(template, params = {}) {
  const errors = [];
  if (!isObj(params)) throw new TemplateError(TEMPLATE_ERROR_CODES.PARAM_TYPE, 'Parameters must be an object of name -> value.');
  for (const key of Object.keys(params)) {
    if (!has(template.parameters, key)) {
      errors.push({ code: TEMPLATE_ERROR_CODES.PARAM_UNKNOWN, path: key, message: `Unknown parameter "${key}". Declared: ${Object.keys(template.parameters).join(', ') || '(none)'}.` });
    }
  }
  const resolved = {};
  for (const [name, spec] of Object.entries(template.parameters)) {
    let value = has(params, name) ? params[name] : undefined;
    if (value === undefined) value = spec.default;
    if (value === undefined) {
      if (spec.required !== false) errors.push({ code: TEMPLATE_ERROR_CODES.PARAM_MISSING, path: name, message: `Missing required parameter "${name}".` });
      continue;
    }
    const bad = checkParamValue(spec, value);
    if (bad) errors.push({ code: bad.code, path: name, message: `Parameter "${name}" ${bad.message}.` });
    else resolved[name] = value;
  }
  if (errors.length) throw new TemplateError(errors[0].code, errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join(' '), errors);
  return resolved;
}

function substitute(value, resolved) {
  // function replacer: a "$&" in a value is inserted literally
  if (typeof value === 'string') return value.replace(PLACEHOLDER, (_, n) => resolved[n] ?? '');
  if (Array.isArray(value)) return value.map((v) => substitute(v, resolved));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, resolved)]));
  return value;
}

function stringsIn(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (isObj(value)) Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

function placeholdersIn(value, out = []) {
  if (typeof value === 'string') for (const m of value.matchAll(PLACEHOLDER)) out.push(m[1]);
  else if (Array.isArray(value)) value.forEach((v) => placeholdersIn(v, out));
  else if (isObj(value)) Object.values(value).forEach((v) => placeholdersIn(v, out));
  return out;
}

/** Instantiate a LOADED template into a concrete plan.v1. Deterministic:
 * the same template and params give a byte-identical plan. Throws
 * TemplateError on a bad parameter; the result is validatePlan()-checked. */
export function instantiate(template, params = {}) {
  const resolved = resolveParams(template, params);
  const steps = substitute(template.steps, resolved);
  const extras = {};
  if (template.summary !== undefined) extras.summary = substitute(template.summary, resolved);
  const plan = createPlan(substitute(template.ticket, resolved), steps, extras);
  const check = validatePlan(plan);
  if (!check.valid) {
    throw new TemplateError(check.errors[0].code, `Template "${template.name}" instantiated an invalid plan: ${formatPlanErrors(check.errors).join('; ')}`, check.errors);
  }
  return plan;
}

/** Validate and normalise a template object. Refuses (TemplateError) at LOAD
 * time: an unknown flow, an undefined parameter, a placeholder where it is
 * forbidden, a malformed parameter, or an `example` that does not itself
 * yield a valid plan. */
export function loadTemplate(raw) {
  const E = TEMPLATE_ERROR_CODES;
  const fail = (code, message) => { throw new TemplateError(code, message); };
  if (!isObj(raw)) fail(E.TEMPLATE_NOT_OBJECT, 'A template must be a JSON object.');
  for (const k of Object.keys(raw)) {
    if (!['templateVersion', 'name', 'description', 'parameters', 'ticket', 'summary', 'steps'].includes(k)) fail(E.TEMPLATE_INVALID, `Unknown template field "${k}".`);
  }
  if (raw.templateVersion !== TEMPLATE_VERSION) fail(E.TEMPLATE_VERSION_INVALID, `"templateVersion" must be ${TEMPLATE_VERSION}.`);
  if (typeof raw.name !== 'string' || !NAME.test(raw.name)) fail(E.TEMPLATE_NAME_INVALID, `"name" must match ${NAME}.`);
  if (typeof raw.description !== 'string' || !raw.description) fail(E.TEMPLATE_INVALID, '"description" must be a non-empty string.');
  if (!isObj(raw.ticket)) fail(E.TEMPLATE_INVALID, '"ticket" must be an object.');
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) fail(E.TEMPLATE_INVALID, '"steps" must be a non-empty array.');
  const parameters = raw.parameters === undefined ? {} : raw.parameters;
  if (!isObj(parameters)) fail(E.TEMPLATE_PARAM_INVALID, '"parameters" must be an object.');

  const params = {};
  const example = {};
  for (const [pname, spec] of Object.entries(parameters)) {
    if (!IDENTIFIER.test(pname)) fail(E.TEMPLATE_PARAM_INVALID, `Parameter name ${JSON.stringify(pname)} is not an identifier.`);
    if (!isObj(spec) || !PARAM_TYPES.includes(spec.type)) fail(E.TEMPLATE_PARAM_INVALID, `Parameter "${pname}" needs a "type" of: ${PARAM_TYPES.join(', ')}.`);
    if (spec.type === 'enum' && (!Array.isArray(spec.values) || spec.values.length === 0 || spec.values.some((v) => typeof v !== 'string'))) {
      fail(E.TEMPLATE_PARAM_INVALID, `Enum parameter "${pname}" needs a non-empty string "values" array.`);
    }
    if (typeof spec.example !== 'string') fail(E.TEMPLATE_PARAM_INVALID, `Parameter "${pname}" needs a string "example" (a concrete value the template is checked with at load time).`);
    if (spec.default !== undefined && checkParamValue(spec, spec.default)) fail(E.TEMPLATE_PARAM_INVALID, `Parameter "${pname}" has an invalid "default".`);
    const bad = checkParamValue(spec, spec.example);
    if (bad) fail(E.TEMPLATE_PARAM_INVALID, `Parameter "${pname}" example ${bad.message}.`);
    params[pname] = { ...spec };
    example[pname] = spec.example;
  }

  raw.steps.forEach((step, i) => {
    if (!isObj(step)) fail(E.TEMPLATE_INVALID, `steps[${i}] must be an object.`);
    if (typeof step.flow !== 'string' || !planFlow(step.flow)) {
      // a placeholder-shaped flow is reported as such, not as "unknown"
      if (BAD_PLACEHOLDER.test(String(step.flow))) fail(E.TEMPLATE_PLACEHOLDER_FORBIDDEN, `steps[${i}].flow must be a literal: a parameter can never choose which flow runs.`);
      fail(E.TEMPLATE_FLOW_UNKNOWN, `steps[${i}] references unknown flow ${JSON.stringify(step.flow)}.`);
    }
    for (const key of ['id', 'executor', 'dependsOn']) {
      if (step[key] !== undefined && stringsIn(step[key]).some((str) => BAD_PLACEHOLDER.test(str))) {
        fail(E.TEMPLATE_PLACEHOLDER_FORBIDDEN, `steps[${i}].${key} must be a literal: a parameter can only fill an argument slot, never choose a flow, id, executor or dependency.`);
      }
    }
    for (const key of Object.keys(isObj(step.args) ? step.args : {})) {
      if (BAD_PLACEHOLDER.test(key)) fail(E.TEMPLATE_PLACEHOLDER_FORBIDDEN, `steps[${i}].args key ${JSON.stringify(key)} must be literal.`);
    }
  });
  const used = placeholdersIn([raw.steps, raw.ticket, raw.summary]);
  for (const n of used) if (!has(params, n)) fail(E.TEMPLATE_PARAM_UNDEFINED, `Placeholder {{${n}}} references an undefined parameter.`);
  if (stringsIn([raw.steps, raw.ticket, raw.summary]).some((str) => BAD_PLACEHOLDER.test(str.replace(PLACEHOLDER, '')))) fail(E.TEMPLATE_INVALID, 'Malformed placeholder: expected {{name}}.');

  const template = {
    templateVersion: TEMPLATE_VERSION,
    name: raw.name,
    description: raw.description,
    parameters: params,
    ticket: raw.ticket,
    ...(raw.summary !== undefined ? { summary: raw.summary } : {}),
    steps: raw.steps,
  };
  try {
    instantiate(template, example);
  } catch (e) {
    if (e instanceof TemplateError) throw new TemplateError(E.TEMPLATE_EXAMPLE_INVALID, `Template "${raw.name}" with its own example values does not yield a valid plan: ${e.message}`, e.errors);
    throw e;
  }
  return template;
}

/** A registry over template objects (the caller decides where they come
 * from — this module owns no curated set). Every template is load-validated. */
export function createTemplateRegistry(templates = []) {
  const byName = new Map();
  for (const raw of templates) {
    const t = loadTemplate(raw);
    if (byName.has(t.name)) throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_DUPLICATE, `Duplicate template name "${t.name}".`);
    byName.set(t.name, t);
  }
  const get = (name) => {
    const t = byName.get(name);
    if (!t) throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_NOT_FOUND, `No template named "${name}". Available: ${[...byName.keys()].sort().join(', ') || '(none)'}.`);
    return t;
  };
  return {
    list: () => [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((t) => ({ name: t.name, description: t.description, parameters: Object.keys(t.parameters) })),
    get,
    instantiate: (name, params) => instantiate(get(name), params),
  };
}

/**
 * Load every `*.json` in a directory the CALLER names (sorted, so the result
 * is deterministic). A missing directory is an error, not an empty set.
 *
 * @param {string} dir Directory of `*.json` plan templates.
 * @returns {object} The parsed templates, in file-name order.
 * @throws {TemplateError} `TEMPLATE_NOT_FOUND` when the directory cannot be read.
 */
export function loadTemplateDir(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_NOT_FOUND, `Cannot read template directory "${dir}": ${e.code || e.message}.`);
  }
  const raws = names.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_INVALID, `${f}: not valid JSON (${e.message}).`);
    }
  });
  return createTemplateRegistry(raws);
}
