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

export const MAX_HEADS = 100;

const refuse = (status, error) => ({ ok: false, status, body: { ok: false, error } });

/** One client-supplied ref -> the listed branch, or a refusal. */
function pick(listing, name, label) {
  if (typeof name !== 'string' || name === '') return refuse(400, `${label} must be the name of a branch.`);
  if (name.startsWith('-')) return refuse(400, `${label} "${name}" is not a valid branch: names cannot start with "-".`);
  const b = localBranches.resolve(listing.branches, name);
  return b ? { ok: true, branch: b } : refuse(404, `${label} "${name}" is not a branch of this project.`);
}

/** The compact, list-sized view of a finished report (the badges). */
export function slimReport(result) {
  const r = result.report;
  return {
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
export function createReviewRouter({ getRoot, jobs }) {
  const router = express.Router();

  /** The project's branches, or an already-shaped refusal. */
  function load() {
    const root = getRoot();
    if (!root.ok) return refuse(400, root.error);
    const listing = localBranches.list(root.root);
    if (!listing.ok) return refuse(400, listing.message);
    return { ok: true, listing };
  }

  const jobFor = (listing, base, head) => ({ root: listing.top, baseSha: base.sha, headSha: head.sha });

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
    for (const head of picked) if (head.name !== b.branch.name) jobs.enqueue(jobFor(l.listing, b.branch, head));
    return res.status(202).json({ ok: true, queued: picked.filter((h) => h.name !== b.branch.name).map((h) => h.name) });
  });

  router.get('/change', (req, res) => {
    const l = load();
    if (!l.ok) return res.status(l.status).json(l.body);
    const b = pick(l.listing, req.query.base, 'base');
    if (!b.ok) return res.status(b.status).json(b.body);
    const h = pick(l.listing, req.query.head, 'head');
    if (!h.ok) return res.status(h.status).json(h.body);
    const entry = jobs.get(jobFor(l.listing, b.branch, h.branch));
    const head = { name: h.branch.name, sha: h.branch.sha, subject: h.branch.subject, author: h.branch.author, date: h.branch.date };
    const base = { name: b.branch.name, sha: b.branch.sha };
    if (entry.state === 'done') {
      const { report, units, unitsOmitted, unitsError } = entry.result;
      return res.json({ ok: true, state: 'done', base, head, report, units, unitsOmitted, ...(unitsError ? { unitsError } : {}) });
    }
    if (entry.state === 'error') return res.json({ ok: true, state: 'error', base, head, error: entry.error });
    return res.json({ ok: true, state: entry.state, base, head });
  });

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
