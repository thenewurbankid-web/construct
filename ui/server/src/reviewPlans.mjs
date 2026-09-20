// #316 -- the "expected scope" source for Review mode: the saved plans of the CURRENT PROJECT, which
// are the plans of the processes in the process store (a process stores its plan verbatim, #287).
//
// SECURITY: a plan id arrives from the CLIENT. It is only ever compared (equality) with the ids the
// store itself lists for the current project; it is never joined into a path, never given to git or a
// shell. What travels on to the engine is the plan's own declared `touches` (planTouches), read from the
// stored record -- never anything the client sent. Read-only: nothing here writes to the store.
import { planTouches } from '../../../src/plan.mjs';
import { isAnalysisPlan } from './reviewAnalyses.mjs';

const pathOf = (f) => (typeof f === 'string' ? f : f?.path);

/** A stored process -> the plan choice the picker shows, with the touches the engine will compare. */
function choiceOf(record) {
  const t = planTouches(record?.plan);
  const files = t.files.map(pathOf).filter((p) => typeof p === 'string' && p);
  return { id: record.id, title: record.title || record.plan?.ticket?.title || record.id, state: record.state, features: t.features, files };
}

/**
 * @param {{records: () => object[]|undefined}} deps `records` returns the current project's process
 *   records (in production: `processesService.store()?.all().processes`).
 */
export function createPlanSource({ records }) {
  const all = () => {
    let list;
    try { list = records() ?? []; } catch { list = []; }
    return list.filter((r) => r && typeof r.id === 'string' && r.plan && !isAnalysisPlan(r.plan)).map(choiceOf);
  };
  return {
    /** Every plan the picker may offer: `{id, title, state, features, files}`. */
    list: all,
    /** The listed plan whose id is EXACTLY `id`, or null. The one place a client string becomes a plan. */
    resolve(id) {
      if (typeof id !== 'string' || id === '' || id.length > 256) return null;
      return all().find((p) => p.id === id) ?? null;
    },
  };
}

/** What the engine's `expected` argument is for a resolved plan (features and file paths only). */
export const expectedOf = (plan) => ({ features: plan.features, files: plan.files });
