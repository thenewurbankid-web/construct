#!/usr/bin/env node
// Live pulse for the Line company: one page that answers "is work moving?" at a glance. Read-only.
//   node packages/tools/paperclip/pulse.mjs            then open http://127.0.0.1:3199
// Options: --api <url> (default http://127.0.0.1:3100), --port <n> (default 3199). Serves on loopback only.
import http from 'node:http';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'http://127.0.0.1:3100');
const PORT = Number(arg('--port', 3199));
const COMPANY = arg('--company', 'Line');
const list = (d) => (Array.isArray(d) ? d : d.items ?? d.runs ?? d.agents ?? d.issues ?? d.companies ?? []);
const get = async (p) => list(await (await fetch(API + p)).json());
const team = (n) => (/Trace|Lead$/.test(n) ? 'Trace' : n.replace(/ (Dev|QA)$/, ''));

async function snapshot() {
  const company = (await get('/api/companies')).find((c) => c.name === COMPANY);
  if (!company) throw new Error(`company ${COMPANY} not found`);
  const C = company.id;
  const [agents, runs, issues] = await Promise.all([get(`/api/companies/${C}/agents`), get(`/api/companies/${C}/heartbeat-runs?limit=400`), get(`/api/companies/${C}/issues?limit=500`)]);
  const now = Date.now();
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const teams = {};
  for (const a of agents) {
    const t = (teams[team(a.name)] ??= { name: team(a.name), agents: 0, paused: 0, running: 0, error: 0, open: 0, recovery: 0, doneToday: 0, lastActivity: 0, buckets: Array(24).fill(0), fails: Array(24).fill(0) });
    t.agents++;
    if (a.status === 'paused') t.paused++;
    if (a.status === 'running') t.running++;
    if (a.status === 'error') t.error++;
  }
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  for (const i of issues) {
    const a = byId[i.assigneeAgentId];
    if (!a) continue;
    const t = teams[team(a.name)];
    if (['todo', 'in_progress', 'blocked', 'in_review'].includes(i.status)) t.open++;
    if (i.activeRecoveryAction) t.recovery++;
    if (i.status === 'done' && Date.parse(i.completedAt ?? i.updatedAt) >= day) t.doneToday++;
    t.lastActivity = Math.max(t.lastActivity, Date.parse(i.updatedAt ?? 0) || 0);
  }
  const events = [];
  for (const r of runs) {
    const a = byId[r.agentId];
    if (!a) continue;
    const t = teams[team(a.name)];
    const at = Date.parse(r.finishedAt ?? r.startedAt ?? r.createdAt);
    t.lastActivity = Math.max(t.lastActivity, at);
    const b = Math.floor((now - at) / (5 * 60 * 1000)); // 24 buckets of 5 min = 2 h
    if (b >= 0 && b < 24) { t.buckets[23 - b]++; if (['failed', 'timed_out'].includes(r.status)) t.fails[23 - b]++; }
    if (events.length < 25 && r.status !== 'queued') events.push({ at, agent: a.name, status: r.status, why: r.errorCode ?? '' });
  }
  const recent = runs.filter((r) => now - Date.parse(r.finishedAt ?? r.createdAt) < 30 * 60 * 1000 && !['queued', 'running'].includes(r.status));
  const ok = recent.filter((r) => r.status === 'succeeded').length;
  const live = runs.filter((r) => r.status === 'running').length;
  const lastAny = Math.max(0, ...Object.values(teams).map((t) => t.lastActivity));
  const count = (s) => issues.filter((i) => i.status === s).length;
  return {
    at: now, live, ok, bad: recent.length - ok, lastAny,
    tasks: { todo: count('todo'), doing: count('in_progress'), review: count('in_review'), blocked: count('blocked'), done: count('done') },
    recovery: issues.filter((i) => i.activeRecoveryAction).length,
    blockedList: issues.filter((i) => i.status === 'blocked').map((i) => ({ id: i.identifier, title: (i.title ?? '').slice(0, 80), who: byId[i.assigneeAgentId]?.name ?? '-' })),
    teams: Object.values(teams).sort((a, b) => a.name.localeCompare(b.name)),
    events,
  };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Line Pulse</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--mute:#6b6b66;--line:#e4e4df;--go:#1f9d55;--warn:#c98a00;--stop:#d64545;--idle:#9a9a94}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--card:#1d1d1b;--ink:#ecece8;--mute:#9a9a94;--line:#2c2c29}}
:root[data-theme="dark"]{--bg:#141413;--card:#1d1d1b;--ink:#ecece8;--mute:#9a9a94;--line:#2c2c29}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 -apple-system,system-ui,sans-serif;padding:16px;max-width:1100px;margin:auto}
.hero{display:flex;align-items:center;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.dot{width:22px;height:22px;border-radius:50%;flex:none}.dot.go{background:var(--go);animation:p 1.6s infinite}.dot.warn{background:var(--warn)}.dot.stop{background:var(--stop)}
@keyframes p{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--go) 60%,transparent)}100%{box-shadow:0 0 0 14px transparent}}
.big{font-size:26px;font-weight:700}.sub{color:var(--mute)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:14px 0}
.k{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.k b{display:block;font-size:22px}.k span{color:var(--mute);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--mute);font-weight:500;font-size:12px}
.st{font-weight:600}.st.go{color:var(--go)}.st.warn{color:var(--warn)}.st.stop{color:var(--stop)}.st.idle{color:var(--idle)}
.spark{display:flex;align-items:flex-end;gap:2px;height:22px}.spark i{width:4px;background:var(--go);border-radius:1px;min-height:1px;opacity:.85}.spark i.f{background:var(--stop)}
.wrap{overflow-x:auto}.feed{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 12px;font-size:13px}
.feed div{padding:3px 0;border-bottom:1px dashed var(--line)}.feed div:last-child{border:0}.mute{color:var(--mute)}
.emerg{margin:14px 0 0;border:2px solid var(--stop);border-radius:14px;padding:12px 16px;background:color-mix(in srgb,var(--stop) 10%,var(--card))}.emerg b.tag{display:inline-block;background:var(--stop);color:#fff;border-radius:6px;padding:2px 8px;margin-right:8px;letter-spacing:.04em}.emerg ul{margin:8px 0 0;padding-left:18px}
@media (max-width:640px){.hide-s{display:none}.big{font-size:21px}}
</style></head><body>
<div class="hero"><div id="dot" class="dot"></div><div><div class="big" id="head">Loading…</div><div class="sub" id="subhead"></div></div></div>
<div class="emerg" id="emerg" hidden></div>
<div class="kpis" id="kpis"></div>
<div class="wrap"><table><thead><tr><th>Team</th><th>State</th><th>Live</th><th>Open</th><th class="hide-s">Recovery</th><th class="hide-s">Done today</th><th>Last activity</th><th>Runs, 2 h</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="feed" id="feed"></div>
<script>
const ago=(t)=>{if(!t)return'never';const s=Math.round((Date.now()-t)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':Math.round(s/3600)+'h ago'};
const esc=(s)=>String(s).replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function state(t){if(t.paused===t.agents)return['idle','paused'];if(t.error)return['stop','error'];if(t.running)return['go','moving'];if(t.open-t.recovery>0)return['warn','idle, has work'];if(t.recovery)return['stop','stuck in recovery'];return['idle','no work']}
async function tick(){try{const d=await (await fetch('/pulse.json')).json();if(d.error)throw new Error(d.error);
const quiet=Date.now()-d.lastAny;const lvl=d.live>0&&quiet<10*60e3?'go':d.live>0||quiet<20*60e3?'warn':'stop';
document.getElementById('dot').className='dot '+lvl;
document.getElementById('head').textContent=lvl==='go'?'Work is moving':lvl==='warn'?'Slowing down':'Stalled';
document.getElementById('subhead').textContent=d.live+' runs live · last activity '+ago(d.lastAny)+' · updated '+new Date(d.at).toLocaleTimeString();
const bl=d.blockedList||[];const em=document.getElementById('emerg');if(bl.length>3){em.hidden=false;em.innerHTML='<b class="tag">⚠ EMERGENCY</b><b>'+bl.length+' tasks blocked</b> (limit 3). The Flow Controller is clearing them.<ul>'+bl.map(b=>'<li>'+esc(b.id)+' · '+esc(b.who)+' · '+esc(b.title)+'</li>').join('')+'</ul>'}else{em.hidden=true}
const k=[['Live runs',d.live],['In progress',d.tasks.doing],['To do',d.tasks.todo],['In review',d.tasks.review],['Blocked',d.tasks.blocked],['Done',d.tasks.done],['Recovery',d.recovery],['30 min ✓ / ✗',d.ok+' / '+d.bad]];
document.getElementById('kpis').innerHTML=k.map(([a,b])=>'<div class="k"><b>'+b+'</b><span>'+a+'</span></div>').join('');
document.getElementById('rows').innerHTML=d.teams.map(t=>{const[c,l]=state(t);const m=Math.max(1,...t.buckets);
return '<tr><td>'+esc(t.name)+'</td><td class="st '+c+'">'+l+'</td><td>'+t.running+'</td><td>'+t.open+'</td><td class="hide-s">'+t.recovery+'</td><td class="hide-s">'+t.doneToday+'</td><td>'+ago(t.lastActivity)+'</td><td><div class="spark">'+t.buckets.map((v,i)=>'<i class="'+(t.fails[i]*2>v&&v?'f':'')+'" style="height:'+Math.round(v/m*22)+'px"></i>').join('')+'</div></td></tr>'}).join('');
document.getElementById('feed').innerHTML='<div class="mute">Latest runs</div>'+d.events.map(e=>'<div>'+new Date(e.at).toLocaleTimeString()+' · '+esc(e.agent)+' · <span class="st '+(e.status==='succeeded'?'go':e.status==='running'?'warn':'stop')+'">'+esc(e.status)+'</span> '+esc(e.why)+'</div>').join('');
}catch(e){document.getElementById('dot').className='dot stop';document.getElementById('head').textContent='Paperclip not reachable';document.getElementById('subhead').textContent=e.message}}
tick();setInterval(tick,10000);
</script></body></html>`;

http.createServer(async (req, res) => {
  if (req.url === '/pulse.json') {
    try { const s = await snapshot(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(s)); }
    catch (e) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(PORT, '127.0.0.1', () => console.log(`Line pulse on http://127.0.0.1:${PORT} (reading ${API})`));
