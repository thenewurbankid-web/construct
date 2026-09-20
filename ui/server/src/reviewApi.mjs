// #312/#313 -- REST surface for Review mode. Read-only: nothing here posts, pushes or modifies a branch.
//
// Mount AFTER `app.use('/api', auth.requireSession)` (index.mjs does). Endpoints:
//   GET  /branches?base=<branch>       the list source's branches with each one's cached badges
//   POST /analyze {base, heads:[...]}  queue analyses (a POST, so a cross-site GET can never start work)
//   GET  /change?base=&head=           one change: state, and the full report once it is done
//
// Every ref is checked against the branch list of the CURRENT PROJECT (see reviewRefs.mjs) and only the
// commit id from that list travels on; the client never supplies a path or a repository.
import express from 'express';
import { commitsAhead, defaultBase, localBranches } from './reviewRefs.mjs';
import { expectedOf } from './reviewPlans.mjs';

export const MAX_HEADS = 100;

const refuse = (status, error) => ({ ok: false, status, body: { ok: false, error } });

/** One client-supplied ref -> the listed branch, or a refusal. */
function pick(listing, name, label) {
  if (typeof name !== 'string' || name === '') return refuse(400, `${label} must be the name of a branch.`);
  if (name.startsWith('-')) return refuse(400, `${label} "${name}" is not a valid branch: names cannot start with "-".`);
  const b = localBranches.resolve(listing.branches, name);
  return b ? { ok: true, branch: b } : refuse(404, `${label} "${name}" is not a branch of this project.`);
}

/** One client-supplied plan id -> the listed plan, no plan (absent), or a refusal. Never a path. */
function pickPlan(plans, id) {
  if (id === undefined || id === null || id === '') return { ok: true, plan: null };
  if (typeof id !== 'string') return refuse(400, 'plan must be the id of a saved plan.');
  const plan = plans.resolve(id);
  return plan ? { ok: true, plan } : refuse(404, 'plan is not a saved plan of this project.');
}

/** The compact, list-sized view of a finished report (the badges). */
export function slimReport(result) {
  const r = result.report;
  const scope = r.indicators.find((i) => i.id === 'blast-radius');
  return {
    scope: scope?.measured ? { declared: scope.evidence.declared.features.length, touched: scope.evidence.touched.features.length } : null,
    summary: r.summary,
    files: r.change.counts.files,
    features: r.change.features,
    findings: r.findings.length,
    counts: r.counts,
    indicators: r.indicators.map((i) => ({ id: i.id, title: i.title, status: i.status, measured: i.measured, headline: i.headline, findings: i.findings.length })),
    degraded: r.degraded ? { truncated: !!r.degraded.truncated, message: r.degraded.message } : null,
  };
}

const rowState = (entry) => (entry.state === 'done' ? { state: 'done', ...slimReport(entry.result) } : entry.state === 'error' ? { state: 'error', error: entry.error } : { state: entry.state });

/**
 * @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, jobs: {enqueue:Function, get:Function}}} deps
 */
export function createReviewRouter({ getRoot, jobs, plans = { list: () => [], resolve: () => null } }) {
  const router = express.Router();

  /** The project's branches, or an already-shaped refusal. */
  function load() {
    const root = getRoot();
    if (!root.ok) return refuse(400, root.error);
    const listing = localBranches.list(root.root);
    if (!listing.ok) return refuse(400, listing.message);
    return { ok: true, listing };
  }

  const jobFor = (listing, base, head, plan = null) => ({
    root: listing.top, baseSha: base.sha, headSha: head.sha,
    // The plan's declared touches come from the store record, never from the request. `planKey` keeps a
    // comparison with a plan apart from the same two commits without one.
    ...(plan ? { expected: expectedOf(plan), planKey: `${plan.id}:${JSON.stringify(expectedOf(plan))}` } : {}),
  });

  router.get('/branches', (req, res) => {
    const l = load();
    if (!l.ok) return res.status(l.status).json(l.body);
    const { listing } = l;
    const requested = typeof req.query.base === 'string' && req.query.base !== '' ? req.query.base : defaultBase(listing.branches, listing.current);
    if (requested === null) return res.json({ ok: true, source: { id: localBranches.id, label: localBranches.label }, base: null, current: listing.current, refs: [], branches: [] });
    const b = pick(listing, requested, 'base');
    if (!b.ok) return res.status(b.status).json(b.body);
    const base = b.branch;
    const branches = listing.branches.filter((x) => x.name !== base.name).map((head) => ({
      name: head.name, sha: head.sha, subject: head.subject, author: head.author, date: head.date, current: head.current,
      ahead: commitsAhead(listing.top, base.sha, head.sha),
      analysis: rowState(jobs.get(jobFor(listing, base, head))),
    }));
    return res.json({ ok: true, source: { id: localBranches.id, label: localBranches.label }, base: base.name, baseSha: base.sha, current: listing.current, refs: listing.branches.map((x) => x.name), branches });
  });

  router.get('/plans', (req, res) => {
    const root = getRoot();
    if (!root.ok) return res.status(400).json({ ok: false, error: root.error });
    return res.json({ ok: true, plans: plans.list().map(({ id, title, state, features, files }) => ({ id, title, state, features, files: files.length })) });
  });

  router.post('/analyze', (req, res) => {
    const l = load();
    if (!l.ok) return res.status(l.status).json(l.body);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const b = pick(l.listing, body.base, 'base');
    if (!b.ok) return res.status(b.status).json(b.body);
    const heads = Array.isArray(body.heads) ? body.heads : typeof body.head === 'string' ? [body.head] : null;
    if (!heads || !heads.length) return res.status(400).json({ ok: false, error: 'heads must be a non-empty list of branch names.' });
    if (heads.length > MAX_HEADS) return res.status(400).json({ ok: false, error: `At most ${MAX_HEADS} branches can be analysed at once.` });
    // Validate them ALL before starting any, so a bad name in the list starts nothing.
    const picked = [];
    for (const name of heads) {
      const h = pick(l.listing, name, 'head');
      if (!h.ok) return res.status(h.status).json(h.body);
      picked.push(h.branch);
    }
    const pl = pickPlan(plans, body.plan);
    if (!pl.ok) return res.status(pl.status).json(pl.body);
    for (const head of picked) if (head.name !== b.branch.name) jobs.enqueue(jobFor(l.listing, b.branch, head, pl.plan));
    return res.status(202).json({ ok: true, queued: picked.filter((h) => h.name !== b.branch.name).map((h) => h.name) });
  });

  router.get('/change', (req, res) => {
    const l = load();
    if (!l.ok) return res.status(l.status).json(l.body);
    const b = pick(l.listing, req.query.base, 'base');
    if (!b.ok) return res.status(b.status).json(b.body);
    const h = pick(l.listing, req.query.head, 'head');
    if (!h.ok) return res.status(h.status).json(h.body);
    const pl = pickPlan(plans, req.query.plan);
    if (!pl.ok) return res.status(pl.status).json(pl.body);
    const entry = jobs.get(jobFor(l.listing, b.branch, h.branch, pl.plan));
    const plan = pl.plan ? { id: pl.plan.id, title: pl.plan.title } : null;
    const head = { name: h.branch.name, sha: h.branch.sha, subject: h.branch.subject, author: h.branch.author, date: h.branch.date };
    const base = { name: b.branch.name, sha: b.branch.sha };
    if (entry.state === 'done') {
      const { report, units, unitsOmitted, unitsError } = entry.result;
      return res.json({ ok: true, state: 'done', base, head, plan, report, units, unitsOmitted, ...(unitsError ? { unitsError } : {}) });
    }
    if (entry.state === 'error') return res.json({ ok: true, state: 'error', base, head, plan, error: entry.error });
    return res.json({ ok: true, state: entry.state, base, head, plan });
  });

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
