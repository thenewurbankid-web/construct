// Pure (DOMAIN-001): Auto's run as a small state machine -- play, pause, one step, wait for the person at Approve,
// stop, finish -- and its captions. The moves themselves happen in workflows/AutoActions.ts on the real controls, so
// every change still goes through the screen's own handlers into the plan API.
import type { AutoAction, RunState } from '../types.ts';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A new run of `script`. */
export function startRun(runId: string, request: string, script: AutoAction[], show: boolean, replay = false): RunState {
  const first = script[0];
  const caption = replay ? `Replay: ${first ? first.caption : 'nothing to show.'}` : first ? first.caption : 'Nothing to do.';
  return { runId, request, script, index: 0, status: first ? 'playing' : 'done', show, replay, stepping: false, caption };
}

/** After one move: the next one, or done. A Step while paused stays paused. */
export function advance(run: RunState): RunState {
  const index = run.index + 1;
  const next = run.script[index];
  if (!next) return { ...run, index, stepping: false, status: 'done', caption: run.replay ? 'Replay finished; nothing was changed.' : 'Auto finished; the plan shows what ran.' };
  return { ...run, index, stepping: false, caption: run.replay ? `Replay: ${next.caption}` : next.caption };
}

/** The person's controls on a run, and Auto's stop at Approve. */
export const RUN = {
  pause: (run: RunState): RunState => (run.status === 'playing' ? { ...run, status: 'paused', caption: `Paused. Next: ${lowerFirst(run.script[run.index]?.caption ?? 'nothing.')}` } : run),
  resume: (run: RunState): RunState => (run.status === 'paused' ? { ...run, status: 'playing', caption: run.script[run.index]?.caption ?? run.caption } : run),
  step: (run: RunState): RunState => (run.status === 'paused' ? { ...run, stepping: true, caption: run.script[run.index]?.caption ?? run.caption } : run),
  stop: (run: RunState, caption = 'Auto stopped; nothing more will be clicked.'): RunState => ({ ...run, status: 'stopped', stepping: false, caption }),
  /** At Approve without the person's leave: Auto waits for them to click it. */
  waitForApproval: (run: RunState): RunState => ({ ...run, status: 'waiting', stepping: false, caption: 'Waiting for you: click Approve to run the change. Auto does not approve unless you let it in this session.' }),
  /** The person clicked Approve while Auto waited. */
  approvedByPerson: (run: RunState): RunState => ({ ...run, index: run.index + 1, status: 'done', caption: 'You approved it; the plan runner runs the change.' }),
};
