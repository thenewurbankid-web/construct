// Train Line (owner, 2026-10-11): the /api/line/train routes of TRAIN_API (packages/engine/line/train/contract.mjs).
// The owner reviews Claude's cases, types requests, corrects the drafter's routes with closed choices, tries a route in a
// scratch copy of an imaginary or sample world (never the open project) and runs eval. Nothing here touches the open
// project: cases are Line's own state under the training root's train/ folder, written through Construct's writer by
// the engine's store, every change logged with who made it ('owner' from Cockpit).
//
//   GET  /train/worlds      the worlds the screen offers
//   GET  /train/cases       ?filter=sample|claude|mine|all&limit=&offset=
//   GET  /train/facts       ?world=  closed choices + the world's domain map
//   POST /train/draft       {request, world}
//   POST /train/preview     {world, request, slots, routes, preferred}
//   POST /train/route       {world, slots, tool, args, label?}   a route added with closed choices
//   POST /train/try         {world, slots, route}
//   POST /train/cases       {world, request, intent, slots, routes, preferred, note?}   the owner saves (agreed)
//   POST /train/review      {id, verdict, note?}   the owner agrees / disagrees with one of Claude's cases
//   POST /train/synonym     {world, word, ref}     "Did you mean ...?" answered
//   POST /train/eval        run eval
//   GET  /train/scoreboard
//
// The training root is LINE_TRAIN_ROOT, else the Construct repo's line/ folder (its train/cases.jsonl is the seed);
// a root with no cases is seeded from the repo's on first open. A LineOpError is a 400 {ok: false, sentence, code}.
import express from 'express';
import { createTrainService } from '../../../packages/engine/line/train/service.mjs';
import { DEFAULT_TRAIN_ROOT } from '../../../packages/engine/line/train/store.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{clientOrigin?: string, root?: string, service?: any}} [deps] `service` for tests (e.g. the engine's mock).
 * @returns {import('express').Router}
 */
export function createLineTrainRouter({ clientOrigin, root, service } = {}) {
  let svc = service ?? null;
  const get = () => (svc ??= createTrainService({ root: root ?? process.env.LINE_TRAIN_ROOT ?? DEFAULT_TRAIN_ROOT, seedFrom: DEFAULT_TRAIN_ROOT }));
  const router = express.Router();
  router.use('/train', (req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send it as JSON.', code: 'NOT_JSON' });
    }
    return next();
  });
  const handle = (fn) => async (req, res) => {
    try {
      return res.json(await fn(get(), plain(req.body), req));
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err?.name === 'LineOpError') return res.status(400).json({ ok: false, sentence: err.sentence, code: err.code });
      if (/There is no (imaginary world|world variant)/.test(String(err?.message))) return res.status(400).json({ ok: false, sentence: 'That world is not offered; pick one from the list.', code: 'UNKNOWN_WORLD' });
      return res.status(500).json({ ok: false, sentence: 'Train Line could not do that; nothing was changed.', code: 'INTERNAL' });
    }
  };
  const q = (req, k) => (typeof req.query[k] === 'string' ? req.query[k] : undefined);
  router.get('/train/worlds', handle((s) => s.worlds()));
  router.get('/train/cases', handle((s, b, req) => s.cases({ filter: q(req, 'filter') ?? 'sample', limit: Number(q(req, 'limit') ?? 5), offset: Number(q(req, 'offset') ?? 0) })));
  router.get('/train/facts', handle((s, b, req) => s.choices(q(req, 'world') ?? 'sample')));
  router.post('/train/draft', handle((s, b) => s.draft({ request: b.request, world: b.world })));
  router.post('/train/preview', handle((s, b) => s.preview(b)));
  router.post('/train/route', handle((s, b) => s.addRoute(b)));
  router.post('/train/try', handle((s, b) => s.try(b)));
  router.post('/train/cases', handle((s, b) => s.save(b)));
  router.post('/train/review', handle((s, b) => s.review({ id: b.id, verdict: b.verdict, note: b.note }, 'owner')));
  router.post('/train/synonym', handle((s, b) => s.addSynonym(b)));
  router.post('/train/eval', handle((s) => s.runEval('owner')));
  router.get('/train/scoreboard', handle((s) => s.scoreboard()));
  return router;
}
