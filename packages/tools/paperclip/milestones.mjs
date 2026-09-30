#!/usr/bin/env node
// Posts milestone updates into Line itself: one unassigned task, "Line: milestone updates", gets a comment whenever
// tasks change status (done, blocked, in review, back to todo from recovery) or new tasks appear. Batches changes into
// at most one comment per --every seconds (default 120). Never assigns, wakes or changes any other task.
//   node packages/tools/paperclip/milestones.mjs [--api URL] [--every SEC]
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'http://127.0.0.1:3100');
const EVERY = Number(arg('--every', 120)) * 1000;
const TITLE = 'Line: milestone updates';
const list = (d) => (Array.isArray(d) ? d : d.items ?? d.issues ?? d.agents ?? d.companies ?? []);
const req = async (method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const C = list(await req('GET', '/api/companies')).find((c) => c.name === 'Line').id;
const all = async () => list(await req('GET', `/api/companies/${C}/issues?limit=500`));
let issues = await all();
let board = issues.find((i) => i.title === TITLE);
if (!board) board = await req('POST', `/api/companies/${C}/issues`, { title: TITLE, description: 'Automatic milestone feed (packages/tools/paperclip/milestones.mjs): status changes, blockers, releases. Unassigned on purpose; nothing works this task.', status: 'backlog', priority: 'low' });
console.log(`posting to ${board.identifier ?? board.id}`);
const label = { done: '✅ done', blocked: '⛔ blocked', in_review: '👀 in review', in_progress: '▶ started', todo: '↺ back to todo', cancelled: '✖ cancelled' };
let prev = new Map(issues.map((i) => [i.id, i.status]));
let pending = [];
let lastPost = 0;
for (;;) {
  await new Promise((r) => setTimeout(r, 30000));
  try {
    const [now, agents] = await Promise.all([all(), req('GET', `/api/companies/${C}/agents`).then(list)]);
    const who = Object.fromEntries(agents.map((a) => [a.id, a.name]));
    for (const i of now) {
      if (i.id === board.id) continue;
      const was = prev.get(i.id);
      const tag = `${i.identifier} ${i.title.slice(0, 70)}${i.assigneeAgentId ? ` (${who[i.assigneeAgentId] ?? '?'})` : ''}`;
      if (was === undefined) pending.push(`🆕 new: ${tag}`);
      else if (was !== i.status && label[i.status] && !(i.status === 'in_progress' && was === 'todo')) pending.push(`${label[i.status]}: ${tag}${was === 'blocked' ? ' (was blocked)' : ''}`);
    }
    prev = new Map(now.map((i) => [i.id, i.status]));
    if (pending.length && Date.now() - lastPost >= EVERY) {
      const n = (s) => now.filter((i) => i.status === s).length;
      const body = `**${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC**: done ${n('done')} · in progress ${n('in_progress')} · review ${n('in_review')} · blocked ${n('blocked')} · todo ${n('todo')}\n\n${pending.map((l) => `- ${l}`).join('\n')}`;
      await req('POST', `/api/issues/${board.id}/comments`, { body });
      console.log(`posted ${pending.length} updates`);
      pending = [];
      lastPost = Date.now();
    }
  } catch (e) {
    console.log(`error: ${e.message}`);
  }
}
