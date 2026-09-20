// #312/#313/#351 -- the analyses behind Review mode, keyed by what they analyse.
//
// Each analysis is a Process (reviewAnalyses.mjs): it is in the Processes drawer, queued behind the
// engine's own slot, and cancellable with the machine's own controls. This file only remembers WHICH
// process analyses WHICH comparison, so asking twice is free and a moved branch (a new commit id) is a new
// analysis. The state of a job is never copied here: it is read from the process record each time.
//
// The key is (project root, base commit, head commit, plan). A finished, running or queued analysis is
// served as it is; a failed, cancelled or vanished one is started again on the next ask.

/**
 * @param {{analyses: {start:Function, stateOf:Function, cancel:Function}}} deps see createAnalyses()
 */
export function createReviewJobs({ analyses }) {
  const known = new Map(); // key -> processId
  const keyOf = ({ root, baseSha, headSha, planKey }) => `${root}\0${baseSha}\0${headSha}\0${planKey ?? ''}`;
  const MAX_KEYS = 500;
  const LIVE = new Set(['queued', 'running', 'paused']);

  const stateOfKey = (key) => {
    const id = known.get(key);
    return id ? analyses.stateOf(id) : { state: 'none' };
  };

  return {
    /** Start the analysis unless one for the same comparison is live or finished. Returns its state. */
    enqueue(job) {
      const key = keyOf(job);
      const current = stateOfKey(key);
      if (current.state !== 'none' && current.state !== 'error' && current.state !== 'cancelled') return current;
      const started = analyses.start(job);
      if (!started.ok) return { state: 'error', error: { code: 'START_FAILED', message: started.error } };
      known.delete(key);
      known.set(key, started.processId);
      while (known.size > MAX_KEYS) known.delete(known.keys().next().value);
      return analyses.stateOf(started.processId);
    },
    /** The current state (`{state, processId?, result?, error?}`), or `{state:'none'}`. */
    get: (job) => stateOfKey(keyOf(job)),
    /** Cancel the live analysis of this comparison with the machine's own CANCEL. -> {status, body} | null when none is live. */
    cancel(job) {
      const key = keyOf(job);
      const current = stateOfKey(key);
      if (!LIVE.has(current.state)) return null;
      return analyses.cancel(current.processId);
    },
    /** How many analyses are waiting or running (tests and status). */
    pending() {
      let n = 0;
      for (const key of known.keys()) if (LIVE.has(stateOfKey(key).state)) n += 1;
      return n;
    },
  };
}
