// Shared helpers for apply.mjs and github-sync.mjs (Paperclip setup as code). Node built-ins only, Node 22 and 24.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_API = 'http://127.0.0.1:3100';

// ---------------------------------------------------------------- output that never leaks a secret
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE|MASTER|CREDENTIAL)/i;
const SECRET_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

/** Mask anything that looks like a token, and the literal value of any secret-named environment variable. */
export function redact(text, env = process.env) {
  let s = String(text);
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_NAME.test(k) && typeof v === 'string' && v.length >= 8) s = s.split(v).join('[redacted]');
  }
  for (const re of SECRET_SHAPES) s = s.replace(re, '[redacted]');
  return s;
}

export function makeOut(stream = process.stdout) {
  return (line = '') => stream.write(redact(line) + '\n');
}

// ---------------------------------------------------------------- loopback guard
export function isLoopbackHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function assertApiBase(api, { allowRemote = false } = {}) {
  let u;
  try {
    u = new URL(api);
  } catch {
    throw new Error(`--api is not a URL: ${api}`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`--api must be http(s): ${api}`);
  if (!allowRemote && !isLoopbackHost(u.hostname)) {
    throw new Error(`Refusing non-loopback API host "${u.hostname}". Paperclip runs on this machine only; pass --allow-remote to override on purpose.`);
  }
  return u.origin;
}

// ---------------------------------------------------------------- a tiny JSON client over built-in fetch
export function createClient(base) {
  async function call(method, urlPath, body) {
    const res = await fetch(base + urlPath, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const detail = json?.error ?? text.slice(0, 300);
      const err = new Error(redact(`${method} ${urlPath} -> ${res.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
      err.status = res.status;
      throw err;
    }
    return json;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
  };
}

/** A list endpoint may answer a bare array or { items | data | issues | agents }. */
export function asList(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') for (const k of ['items', 'data', 'results', 'issues', 'agents', 'goals', 'labels']) if (Array.isArray(x[k])) return x[k];
  return [];
}

// ---------------------------------------------------------------- config
export function stripComments(v) {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!k.startsWith('$comment')) o[k] = stripComments(x);
    return o;
  }
  return v;
}

export function expandVars(v, vars) {
  if (typeof v === 'string') return v.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (Array.isArray(v)) return v.map((x) => expandVars(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandVars(x, vars)]));
  return v;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = k in a ? deepMerge(a[k], v) : v;
  return o;
}

export const REDACTED = '***REDACTED***';

/**
 * Paths (dotted) where `desired` is not contained in `actual`. Objects are compared as subsets, arrays and scalars exactly.
 * Paperclip redacts some values on read (for example allowlist hostnames come back as ***REDACTED***): a redacted actual
 * value cannot be compared, so it counts as equal (an array must still have the same length).
 */
export function diffSubset(desired, actual, prefix = '') {
  if (actual === REDACTED) return [];
  if (isObj(desired)) {
    const out = [];
    for (const [k, v] of Object.entries(desired)) out.push(...diffSubset(v, isObj(actual) ? actual[k] : undefined, prefix ? `${prefix}.${k}` : k));
    return out;
  }
  if (Array.isArray(desired) && Array.isArray(actual)) {
    if (desired.length !== actual.length) return [prefix || '(value)'];
    return desired.flatMap((v, i) => diffSubset(v, actual[i], prefix ? `${prefix}[${i}]` : `[${i}]`)).length ? [prefix || '(value)'] : [];
  }
  return desired === undefined || JSON.stringify(desired) === JSON.stringify(actual ?? null) ? [] : [prefix || '(value)'];
}

export function loadConfig(file = path.join(HERE, 'company.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.$file = file;
  return cfg;
}

export function configVars(cfg, overrides = {}) {
  return { repoRoot: overrides.repoRoot || cfg.paths?.repoRoot || process.cwd(), home: os.homedir() };
}

/** Safety validation: refuse a config that would start something on its own. */
export function validateConfig(cfg) {
  const problems = [];
  const keys = new Set();
  for (const a of cfg.agents ?? []) {
    if (keys.has(a.key)) problems.push(`duplicate agent key ${a.key}`);
    keys.add(a.key);
  }
  for (const a of cfg.agents ?? []) {
    if (a.reportsTo && !keys.has(a.reportsTo)) problems.push(`${a.key}: reportsTo ${a.reportsTo} is not an agent key`);
    if (a.heartbeat?.enabled !== false) problems.push(`${a.key}: heartbeat.enabled must be false in company.json (the owner enables OG's timer by hand, README)`);
    const cents = cfg.budgets?.agents?.[a.key];
    if (!Number.isInteger(cents) || cents <= 0) problems.push(`${a.key}: budgets.agents.${a.key} must be a positive integer of cents (0 means no policy)`);
    const ac = deepMerge(cfg.adapterDefaults ?? {}, a.adapterConfig ?? {});
    if (/fable/i.test(String(ac.model))) problems.push(`${a.key}: model ${ac.model} is not allowed (model routing rule: default model, no Fable)`);
    if (!ac.model) problems.push(`${a.key}: model must be set explicitly`);
    if (ac.filesystemScope !== 'workspace') problems.push(`${a.key}: filesystemScope must be "workspace"`);
    if (ac.networkScope !== 'allowlist') problems.push(`${a.key}: networkScope must be "allowlist"`);
    if (ac.workspaceStrategy?.type !== 'git_worktree') problems.push(`${a.key}: workspaceStrategy.type must be git_worktree`);
    if (typeof ac.dangerouslySkipPermissions !== 'boolean') problems.push(`${a.key}: dangerouslySkipPermissions must be set explicitly`);
    if (!Number.isInteger(ac.maxTurnsPerRun) || !Number.isInteger(ac.timeoutSec)) problems.push(`${a.key}: maxTurnsPerRun and timeoutSec must be bounded integers`);
    if (!fs.existsSync(path.join(HERE, 'agents', a.key, 'AGENTS.md'))) problems.push(`${a.key}: agents/${a.key}/AGENTS.md is missing`);
  }
  if (!Number.isInteger(cfg.budgets?.company) || cfg.budgets.company <= 0) problems.push('budgets.company must be a positive integer of cents');
  if (problems.length) throw new Error('company.json is not safe to apply:\n  - ' + problems.join('\n  - '));
}

// ---------------------------------------------------------------- resolved desired state
const byKey = (cfg, key) => cfg.agents.find((a) => a.key === key);

export function readBundle(agent, baseRef) {
  const dir = path.join(HERE, 'agents', agent.key);
  const shared = path.join(HERE, 'agents', '_shared');
  const push = String(baseRef).replace(/^origin\//, '');
  const files = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    let text = fs.readFileSync(path.join(dir, f), 'utf8');
    text = text.replace(/<!--\s*include:\s*\.\.\/_shared\/([\w.-]+)\s*-->/g, (m, name) => fs.readFileSync(path.join(shared, name), 'utf8').trimEnd());
    text = text.replaceAll('{{BASE_REF}}', baseRef).replaceAll('{{PUSH_BRANCH}}', push);
    files[f] = text.trimEnd() + '\n';
  }
  return { entryFile: 'AGENTS.md', files };
}

export function resolveAgent(cfg, agent, vars) {
  const base = stripComments(expandVars(deepMerge(cfg.adapterDefaults ?? {}, agent.adapterConfig ?? {}), { ...vars, key: agent.key }));
  const hb = agent.heartbeat ?? { enabled: false };
  return {
    key: agent.key,
    reportsToKey: agent.reportsTo ?? null,
    hold: !!agent.hold,
    body: {
      name: agent.name,
      role: agent.role,
      title: agent.title ?? null,
      icon: agent.icon ?? null,
      capabilities: agent.capabilities ?? null,
      adapterType: 'claude_local',
      adapterConfig: base,
      runtimeConfig: { heartbeat: stripComments({ enabled: hb.enabled === true ? true : false, ...(hb.intervalSec ? { intervalSec: hb.intervalSec } : {}) }) },
      budgetMonthlyCents: cfg.budgets.agents[agent.key],
      permissions: { canCreateAgents: false, canCreateSkills: false },
    },
    bundle: readBundle(agent, base.workspaceStrategy?.baseRef ?? 'origin/work/2026-09-23'),
  };
}

/** Agents ordered so that a manager always precedes its reports. */
export function orderAgents(cfg) {
  const out = [];
  const seen = new Set();
  const visit = (a) => {
    if (seen.has(a.key)) return;
    seen.add(a.key);
    if (a.reportsTo) visit(byKey(cfg, a.reportsTo));
    out.push(a);
  };
  cfg.agents.forEach(visit);
  return out;
}

export const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').trimEnd();
