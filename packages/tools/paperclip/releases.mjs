#!/usr/bin/env node
// Keeps a "Line: releases & milestones" page inside Paperclip: past, current and next milestones and releases, with
// due dates, progress and a forecast ETA. Sources: GitHub milestones of the configured repo (reads only, via gh), the
// Trace changelog and RELEASE file, and Line's own task throughput for Trace. Writes one Paperclip document
// (key "releases") on an unassigned backlog task, so no agent is ever woken. Refreshes every --every minutes (default 15);
// --once writes once and exits.
//   node packages/tools/paperclip/releases.mjs [--once] [--every MIN] [--api URL]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { HERE, loadConfig } from './lib.mjs';

const sh = promisify(execFile);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'http://127.0.0.1:3100');
const EVERY = Number(arg('--every', 15)) * 60 * 1000;
const ONCE = process.argv.includes('--once');
const TITLE = 'Line: releases & milestones';
const TRACE = path.resolve(HERE, '../../../trace');
const cfg = loadConfig();
const REPO = cfg.github.repo;
const DAY = 86400000;

const list = (d) => (Array.isArray(d) ? d : d.items ?? d.issues ?? d.companies ?? []);
const req = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const gh = async (args) => JSON.parse((await sh('gh', args, { maxBuffer: 32 * 1024 * 1024 })).stdout);
const d10 = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '-');
const bar = (done, total) => { const n = total ? Math.round((done / total) * 10) : 0; return `${'█'.repeat(n)}${'░'.repeat(10 - n)} ${total ? Math.round((done / total) * 100) : 0}%`; };

// ETA from the recent close rate: open / (closed in the last `days` days / days). null when nothing closed recently.
export function eta(open, closedTimes, now = Date.now(), days = 7) {
  if (!open) return { date: now, rate: null };
  const recent = closedTimes.filter((t) => now - t <= days * DAY).length;
  if (!recent) return { date: null, rate: 0 };
  const rate = recent / days;
  return { date: now + (open / rate) * DAY, rate };
}
const verdict = (etaDate, due) => {
  if (!etaDate) return '⚪ no recent progress, no forecast';
  if (!due) return '🔵 no due date';
  const slip = Math.round((etaDate - due) / DAY);
  return slip <= 0 ? `🟢 on track (${-slip}d spare)` : slip <= 7 ? `🟡 at risk (${slip}d late)` : `🔴 late by ~${slip}d`;
};

async function githubSection(now) {
  const ms = await gh(['api', `repos/${REPO}/milestones?state=all&per_page=100`]);
  const byDue = (a, b) => (Date.parse(a.due_on ?? '9999') || 9e15) - (Date.parse(b.due_on ?? '9999') || 9e15);
  const past = ms.filter((m) => m.state === 'closed').sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at));
  const open = ms.filter((m) => m.state === 'open').sort(byDue);
  const rows = [];
  for (const [i, m] of open.entries()) {
    const closed = await gh(['issue', 'list', '--repo', REPO, '--milestone', m.title, '--state', 'closed', '--limit', '500', '--json', 'closedAt']);
    const e = eta(m.open_issues, closed.map((c) => Date.parse(c.closedAt)), now);
    const due = m.due_on ? Date.parse(m.due_on) : null;
    rows.push(`| ${i === 0 ? '**Current**' : 'Next'} | **${m.title}** | ${d10(due)} | ${bar(m.closed_issues, m.open_issues + m.closed_issues)} (${m.closed_issues}/${m.open_issues + m.closed_issues}) | ${e.date ? d10(e.date) : '-'} | ${e.rate ? `${e.rate.toFixed(1)}/day` : '0/day'} | ${verdict(e.date, due)} |`);
  }
  const pastRows = past.map((m) => {
    const late = m.due_on ? Math.round((Date.parse(m.closed_at) - Date.parse(m.due_on)) / DAY) : null;
    return `| Past | ${m.title} | ${d10(m.due_on)} | closed ${d10(m.closed_at)} (${m.closed_issues} closed, ${m.open_issues} moved on) | ${late === null ? '-' : late <= 0 ? `✅ ${-late}d early` : `⚠️ ${late}d late`} |`;
  });
  return [
    `## Construct (GitHub ${REPO})`, '',
    '| | Milestone | Due | Progress | ETA | Close rate (7d) | Status |', '|---|---|---|---|---|---|---|',
    ...rows, '',
    '| | Milestone | Due | Outcome | vs due |', '|---|---|---|---|---|',
    ...pastRows,
  ].join('\n');
}

function traceReleases() {
  const log = fs.readFileSync(path.join(TRACE, 'CHANGELOG.md'), 'utf8');
  const current = fs.existsSync(path.join(TRACE, 'RELEASE')) ? fs.readFileSync(path.join(TRACE, 'RELEASE'), 'utf8').trim() : null;
  const heads = [...log.matchAll(/^(##|###) (R[\d.]+|Unreleased)\s+[—-]\s+(.+)$/gm)].map((m) => ({ id: m[2], note: m[3].trim(), minor: m[1] === '###' }));
  return { current, heads };
}

async function traceSection(C, now) {
  const { current, heads } = traceReleases();
  const issues = list(await req('GET', `/api/companies/${C}/issues?limit=500`)).filter((i) => /^\[(CON|TR)-/.test(i.title ?? ''));
  const open = issues.filter((i) => !['done', 'cancelled'].includes(i.status));
  const doneTimes = issues.filter((i) => i.status === 'done').map((i) => Date.parse(i.completedAt ?? i.updatedAt));
  const e = eta(open.length, doneTimes, now, 2);
  const blocked = open.filter((i) => i.status === 'blocked').length;
  const next = heads.find((h) => h.id === 'Unreleased');
  const past = heads.filter((h) => h.id !== 'Unreleased' && h.id !== current).slice(0, 8);
  return [
    '## Trace (trace/, releases from CHANGELOG.md)', '',
    `| | Release | Detail |`, '|---|---|---|',
    `| **Current** | **${current ?? past[0]?.id ?? '-'}** | from \`trace/RELEASE\` |`,
    `| Next | ${next ? `Unreleased: ${next.note}` : 'next R (not yet named)'} | ${open.length} open Trace tasks (${blocked} blocked), ${doneTimes.length} done · ETA to clear the open list: **${e.date ? d10(e.date) : 'no forecast (nothing done in 48h)'}**${e.rate ? ` at ${e.rate.toFixed(1)} tasks/day` : ''} |`,
    ...past.map((h) => `| Past | ${h.minor ? '↳ ' : ''}${h.id} | ${h.note} |`),
  ].join('\n');
}

async function render() {
  const now = Date.now();
  const C = list(await req('GET', '/api/companies')).find((c) => c.name === cfg.company.name).id;
  const all = list(await req('GET', `/api/companies/${C}/issues?limit=500`));
  let page = all.find((i) => i.title === TITLE);
  if (!page) page = await req('POST', `/api/companies/${C}/issues`, { title: TITLE, status: 'backlog', priority: 'low', description: 'Live page, refreshed by packages/tools/paperclip/releases.mjs. Open the "releases" document. Unassigned on purpose; nothing works this task.' });
  const body = [
    `# Line releases & milestones`, '',
    `Updated ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC. ETA = open items ÷ recent close rate (GitHub: last 7 days; Trace: last 48 h of Line tasks). It is a forecast from real throughput, not a promise; 🟢 on track · 🟡 up to a week late · 🔴 later than that.`, '',
    await githubSection(now), '',
    await traceSection(C, now),
  ].join('\n');
  // updates must name the revision they replace
  let baseRevisionId = null;
  try { baseRevisionId = (await req('GET', `/api/issues/${page.id}/documents/releases`)).latestRevisionId ?? null; } catch (e) { if (!/ 404 /.test(e.message)) throw e; }
  await req('PUT', `/api/issues/${page.id}/documents/releases`, { title: 'Releases & milestones', format: 'markdown', body, changeSummary: 'refresh', baseRevisionId });
  return page.identifier ?? page.id;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  for (;;) {
    try { console.log(`${new Date().toISOString().slice(11, 16)}Z wrote releases page on ${await render()}`); }
    catch (e) { console.log(`error: ${e.message}`); }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, EVERY));
  }
}
