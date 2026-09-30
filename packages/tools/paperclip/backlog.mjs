#!/usr/bin/env node
// Files a backlog (backlog/<name>.json) into the Line company as Paperclip tasks.
//   node packages/tools/paperclip/backlog.mjs                   dry run (default): prints what it would create, writes nothing
//   node packages/tools/paperclip/backlog.mjs --apply           create the missing tasks
// Options: --api <url> (loopback only unless --allow-remote), --config <company.json>, --file <backlog.json> (default backlog/trace.json).
// Each task becomes "[ID] title" under the project and assignee named by company.json keys. A task whose "[ID] " prefix
// already exists is left alone (never duplicated, never patched, never deleted). Needs apply.mjs --apply first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API, HERE, asList, assertApiBase, createClient, loadConfig, makeOut } from './lib.mjs';

export function parseArgs(argv) {
  const o = { api: DEFAULT_API, apply: false, allowRemote: false, config: undefined, file: path.join(HERE, 'backlog', 'trace.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--allow-remote') o.allowRemote = true;
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--file') o.file = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

export async function run(argv, { out = makeOut() } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out('usage: backlog.mjs [--apply] [--api URL] [--allow-remote] [--config FILE] [--file BACKLOG.json]');
    return 0;
  }
  const base = assertApiBase(opts.api, { allowRemote: opts.allowRemote });
  const api = createClient(base);
  const cfg = opts.config ? loadConfig(path.resolve(opts.config)) : loadConfig();
  const backlog = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  const write = opts.apply;
  out(`Paperclip ${base} | backlog ${path.basename(opts.file)} (${backlog.tasks.length} tasks) | ${write ? 'APPLY (writes)' : 'DRY RUN (no writes; add --apply)'}`);

  const company = asList(await api.get('/api/companies')).find((c) => c.name === cfg.company.name);
  if (!company) throw new Error(`Paperclip company "${cfg.company.name}" does not exist; run apply.mjs --apply first`);
  const projects = asList(await api.get(`/api/companies/${company.id}/projects`));
  const agents = asList(await api.get(`/api/companies/${company.id}/agents`));
  const projectId = (key) => {
    const name = cfg.projects?.find((p) => p.key === key)?.name;
    const id = projects.find((p) => p.name === name)?.id;
    if (!id) throw new Error(`project "${key}" is not in Paperclip; run apply.mjs --apply first`);
    return id;
  };
  const agentId = (key) => {
    const name = cfg.agents.find((a) => a.key === key)?.name;
    const id = agents.find((a) => a.name === name)?.id;
    if (!id) throw new Error(`agent "${key}" is not in Paperclip; run apply.mjs --apply first`);
    return id;
  };
  const issues = [];
  for (let offset = 0; ; offset += 200) {
    const page = asList(await api.get(`/api/companies/${company.id}/issues?limit=200&offset=${offset}`));
    const fresh = page.filter((p) => !issues.some((i) => i.id === p.id));
    if (!fresh.length) break;
    issues.push(...fresh);
    if (page.length < 200) break;
  }

  let created = 0;
  for (const t of backlog.tasks) {
    const title = `[${t.id}] ${t.title}`;
    const have = issues.find((i) => (i.title ?? '').startsWith(`[${t.id}] `));
    if (have) {
      out(`OK ${t.id} ${have.id} (${have.status})`);
      continue;
    }
    const body = {
      title, description: t.description ?? '', status: t.status ?? backlog.status ?? 'backlog', priority: t.priority ?? 'medium',
      projectId: projectId(t.project), assigneeAgentId: agentId(t.assignee),
    };
    created++;
    out(`CREATE ${t.id} -> ${t.project} / ${t.assignee} [${body.priority}, ${body.status}] ${t.title.slice(0, 70)}`);
    if (write) await api.post(`/api/companies/${company.id}/issues`, body);
  }
  out('');
  out(`${write ? 'Created' : 'Would create'} ${created} task${created === 1 ? '' : 's'}.${created === 0 ? ' Nothing to do.' : ''}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`backlog.mjs: ${String(e.message).replace(/\n/g, '\n  ')}\n`);
      process.exit(/Refusing|Unknown argument|not a URL|must be http/.test(e.message) ? 2 : 1);
    },
  );
}
