// A small in-memory stand-in for the Paperclip API, used only by the tests (ports 49600-49649).
// It mirrors the documented behaviour of the endpoints apply.mjs and github-sync.mjs use, and records every request.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const PORT_FIRST = 49600;
export const PORT_LAST = 49649;

const merge = (a, b) => {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = k in a ? merge(a[k], v) : v;
  return o;
};

export async function startMock({ leakSecretOn = null } = {}) {
  const db = { companies: [], agents: [], goals: [], labels: [], issues: [], policies: [], files: {} };
  const log = [];
  const policyFor = (scopeType, scopeId) => db.policies.find((p) => p.scopeType === scopeType && p.scopeId === scopeId);
  const upsertPolicy = (companyId, scopeType, scopeId, amount, extra = {}) => {
    let p = policyFor(scopeType, scopeId);
    if (!p) db.policies.push((p = { policyId: randomUUID(), companyId, scopeType, scopeId, metric: 'billed_cents', windowKind: 'calendar_month_utc', warnPercent: 80, hardStopEnabled: true, notifyEnabled: true, isActive: true }));
    p.amount = amount;
    Object.assign(p, extra);
    return p;
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : undefined;
    log.push({ method: req.method, path: url.pathname, query: url.search, body });
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const p = url.pathname;
    let m;
    if (leakSecretOn && p.includes(leakSecretOn)) return send(500, { error: 'upstream rejected token ghp_abcdefghijklmnopqrstuvwxyz0123456789 for this call' });

    if (p === '/api/companies' && req.method === 'GET') return send(200, db.companies);
    if (p === '/api/companies' && req.method === 'POST') {
      const c = { id: randomUUID(), name: body.name, description: body.description ?? null, budgetMonthlyCents: body.budgetMonthlyCents ?? 0 };
      db.companies.push(c);
      if (c.budgetMonthlyCents > 0) upsertPolicy(c.id, 'company', c.id, c.budgetMonthlyCents);
      return send(201, c);
    }
    if ((m = /^\/api\/companies\/([^/]+)$/.exec(p)) && req.method === 'PATCH') {
      const c = db.companies.find((x) => x.id === m[1]);
      Object.assign(c, body);
      return send(200, c);
    }
    if ((m = /^\/api\/companies\/([^/]+)\/budgets$/.exec(p)) && req.method === 'PATCH') {
      const c = db.companies.find((x) => x.id === m[1]);
      c.budgetMonthlyCents = body.budgetMonthlyCents;
      upsertPolicy(c.id, 'company', c.id, body.budgetMonthlyCents);
      return send(200, c);
    }
    if ((m = /^\/api\/companies\/([^/]+)\/budgets\/overview$/.exec(p))) return send(200, { policies: db.policies.filter((x) => x.companyId === m[1]) });
    if ((m = /^\/api\/companies\/([^/]+)\/budgets\/policies$/.exec(p)) && req.method === 'POST') {
      const { scopeType, scopeId, amount, ...rest } = body;
      return send(200, upsertPolicy(m[1], scopeType, scopeId, amount, rest));
    }
    if ((m = /^\/api\/companies\/([^/]+)\/agents$/.exec(p))) {
      if (req.method === 'GET') return send(200, db.agents.filter((a) => a.companyId === m[1]).map(({ adapterConfig, ...a }) => a));
      const { instructionsBundle, ...rest } = body;
      const a = { id: randomUUID(), companyId: m[1], status: 'idle', spentMonthlyCents: 0, lastHeartbeatAt: null, ...rest };
      db.agents.push(a);
      db.files[a.id] = { ...(instructionsBundle?.files ?? {}) };
      if ((a.budgetMonthlyCents ?? 0) > 0) upsertPolicy(m[1], 'agent', a.id, a.budgetMonthlyCents);
      return send(201, a);
    }
    if ((m = /^\/api\/agents\/([^/]+)$/.exec(p))) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return send(404, { error: 'not found' });
      if (req.method === 'GET') {
        // like the real API, reads redact some values (allowlist hostnames come back as ***REDACTED***)
        const al = a.adapterConfig?.networkAllowlist;
        return send(200, al ? { ...a, adapterConfig: { ...a.adapterConfig, networkAllowlist: al.map((h) => (h === 'github.com' ? h : '***REDACTED***')) } } : a);
      }
      if (req.method === 'PATCH') {
        for (const [k, v] of Object.entries(body)) a[k] = k === 'adapterConfig' || k === 'runtimeConfig' ? merge(a[k] ?? {}, v) : v;
        return send(200, a);
      }
    }
    if ((m = /^\/api\/agents\/([^/]+)\/(pause|resume)$/.exec(p)) && req.method === 'POST') {
      const a = db.agents.find((x) => x.id === m[1]);
      a.status = m[2] === 'pause' ? 'paused' : 'idle';
      return send(200, a);
    }
    if ((m = /^\/api\/agents\/([^/]+)\/budgets$/.exec(p)) && req.method === 'PATCH') {
      const a = db.agents.find((x) => x.id === m[1]);
      a.budgetMonthlyCents = body.budgetMonthlyCents;
      upsertPolicy(a.companyId, 'agent', a.id, body.budgetMonthlyCents);
      return send(200, a);
    }
    if ((m = /^\/api\/agents\/([^/]+)\/instructions-bundle\/file$/.exec(p))) {
      const files = db.files[m[1]] ?? (db.files[m[1]] = {});
      if (req.method === 'GET') {
        const f = url.searchParams.get('path');
        return f in files ? send(200, { path: f, content: files[f] }) : send(404, { error: 'file not found' });
      }
      if (req.method === 'PUT') {
        files[body.path] = body.content;
        return send(200, { path: body.path });
      }
    }
    if ((m = /^\/api\/companies\/([^/]+)\/goals$/.exec(p))) {
      if (req.method === 'GET') return send(200, db.goals);
      const g = { id: randomUUID(), companyId: m[1], ...body };
      db.goals.push(g);
      return send(201, g);
    }
    if ((m = /^\/api\/goals\/([^/]+)$/.exec(p)) && req.method === 'PATCH') {
      const g = db.goals.find((x) => x.id === m[1]);
      Object.assign(g, body);
      return send(200, g);
    }
    if ((m = /^\/api\/companies\/([^/]+)\/labels$/.exec(p))) {
      if (req.method === 'GET') return send(200, db.labels);
      const l = { id: randomUUID(), ...body };
      db.labels.push(l);
      return send(201, l);
    }
    if ((m = /^\/api\/companies\/([^/]+)\/issues$/.exec(p))) {
      if (req.method === 'GET') {
        const off = Number(url.searchParams.get('offset') ?? 0);
        const lim = Number(url.searchParams.get('limit') ?? 50);
        return send(200, db.issues.slice(off, off + lim));
      }
      const i = { id: randomUUID(), status: 'backlog', ...body };
      db.issues.push(i);
      return send(201, i);
    }
    if ((m = /^\/api\/issues\/([^/]+)$/.exec(p)) && req.method === 'PATCH') {
      const i = db.issues.find((x) => x.id === m[1]);
      Object.assign(i, body);
      return send(200, i);
    }
    return send(404, { error: `no mock route for ${req.method} ${p}` });
  }

  let server;
  let port = PORT_FIRST;
  for (; port <= PORT_LAST; port++) {
    server = http.createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e.stack) })); }));
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) break;
    server.close();
  }
  if (port > PORT_LAST) throw new Error('no free port in 49600-49649');
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    log,
    writes: () => log.filter((r) => r.method !== 'GET'),
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }),
  };
}
