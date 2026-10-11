// Pure (DOMAIN-001): Auto's run as a small state machine -- play, pause, one step, wait for the person at Approve,
// stop, finish -- and its captions. The moves themselves happen in workflows/AutoActions.ts on the real controls, so
// every change still goes through the screen's own handlers into the plan API.
import type { AutoAction, RunState, TraceRun, TraceSettings } from '../types.ts';

export const SPEEDS = [0.5, 1, 2] as const;
export const HISTORY_SIZE = 10;

export const DEFAULT_SETTINGS: TraceSettings = {
  trace: false,
  auto: false,
  request: '',
  autoApprove: false,
  speed: 1,
  history: [],
  run: null,
};

/** How long the cursor takes to reach a control, in ms. Auto alone has no show and goes straight on. */
export function delayFor(speed: number, show: boolean): number {
  return show ? Math.round(900 / speed) : 40;
}

/** A new run of `script`. */
export function startRun(runId: string, request: string, script: AutoAction[], show: boolean, replay = false): RunState {
  const first = script[0];
  const caption = replay ? `Replay: ${first ? first.caption : 'nothing to show.'}` : first ? first.caption : 'Nothing to do.';
  return {
    runId,
    request,
    script,
    index: 0,
    status: first ? 'playing' : 'done',
    show,
    replay,
    stepping: false,
    caption,
  };
}

/** After one move: the next one, or done. A Step while paused stays paused. */
export function advance(run: RunState): RunState {
  const index = run.index + 1;
  const next = run.script[index];
  if (!next)
    return {
      ...run,
      index,
      stepping: false,
      status: 'done',
      caption: run.replay ? 'Replay finished; nothing was changed.' : 'Auto finished; the plan shows what ran.',
    };
  return {
    ...run,
    index,
    stepping: false,
    caption: run.replay ? `Replay: ${next.caption}` : next.caption,
  };
}

export const pauseRun = (run: RunState): RunState =>
  run.status === 'playing'
    ? {
        ...run,
        status: 'paused',
        caption: `Paused. Next: ${lowerFirst(run.script[run.index]?.caption ?? 'nothing.')}`,
      }
    : run;
export const resumeRun = (run: RunState): RunState =>
  run.status === 'paused'
    ? {
        ...run,
        status: 'playing',
        caption: run.script[run.index]?.caption ?? run.caption,
      }
    : run;
export const stepRun = (run: RunState): RunState =>
  run.status === 'paused'
    ? {
        ...run,
        stepping: true,
        caption: run.script[run.index]?.caption ?? run.caption,
      }
    : run;
export const stopRun = (run: RunState, caption = 'Auto stopped; nothing more will be clicked.'): RunState => ({
  ...run,
  status: 'stopped',
  stepping: false,
  caption,
});

/** At Approve without the person's leave: Auto waits for them to click it. */
export function waitForApproval(run: RunState): RunState {
  return {
    ...run,
    status: 'waiting',
    stepping: false,
    caption: 'Waiting for you: click Approve to run the change. Auto does not approve unless you let it in this session.',
  };
}

/** The person clicked Approve while Auto waited. */
export function approvedByPerson(run: RunState): RunState {
  return {
    ...run,
    index: run.index + 1,
    status: 'done',
    caption: 'You approved it; the plan runner runs the change.',
  };
}

/** Whether the run is still going (or waiting), so its controls show. */
export function isActive(run: RunState | null): boolean {
  return run !== null && (run.status === 'playing' || run.status === 'paused' || run.status === 'waiting');
}

/** Whether the player should make the current move now. */
export function shouldMove(run: RunState | null): boolean {
  return run !== null && (run.status === 'playing' || (run.status === 'paused' && run.stepping));
}

/** The history with a new run first, at most HISTORY_SIZE kept. */
export function withHistory(history: TraceRun[], run: TraceRun): TraceRun[] {
  return [run, ...history.filter((h) => h.id !== run.id)].slice(0, HISTORY_SIZE);
}

/** The settings as stored for the tab (anything unreadable falls back to the defaults). */
export function parseSettings(raw: string | null): TraceSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<TraceSettings>;
    return {
      trace: v.trace === true,
      auto: v.auto === true,
      request: typeof v.request === 'string' ? v.request : '',
      autoApprove: v.autoApprove === true,
      speed: SPEEDS.includes(v.speed as (typeof SPEEDS)[number]) ? (v.speed as number) : 1,
      history: Array.isArray(v.history) ? v.history.slice(0, HISTORY_SIZE) : [],
      run: v.run && typeof v.run === 'object' && Array.isArray(v.run.script) ? v.run : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
