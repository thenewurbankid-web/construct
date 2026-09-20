// Starting, reading and cancelling a test run (ui/server's /api/tests/:feature/run, runs and run/cancel). The client
// sends the feature (from the server's own list), optionally one test's file NAME + area, and the app's address; the
// server compares each with what is really on disk and derives every path. Cancel names only the feature.
import { getJson, postJson } from '@/lib/http';
import type { RunReply, RunSnapshot, RunTarget } from '../types';
import { testsBase } from './TestsPaths';

const DOWN = 'The Cockpit server could not be reached.';
type Body = (RunSnapshot & { ok: true }) | { ok?: false; error?: string; code?: string; tests?: RunSnapshot['tests'] };

const asReply = (body: Body): RunReply => {
  if (body.ok) return { ok: true, snap: body as RunSnapshot };
  return { ok: false, error: body.error ?? 'The run could not be started.', code: body.code, ...(body.tests ? { snap: body as unknown as RunSnapshot } : {}) };
};

/** Where the run stands: the live run, the latest result of every test and the newest problem. Read-only. */
export async function fetchRuns(feature: string): Promise<RunReply> {
  try {
    return asReply(await getJson<Body>(`${testsBase(feature)}/runs`));
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** Run every test of the feature, or the one named. `baseUrl` is only an address; the server checks it. */
export async function startRun(feature: string, target: RunTarget, baseUrl: string): Promise<RunReply> {
  try {
    return asReply(await postJson<Body>(`${testsBase(feature)}/run`, { ...(target ?? {}), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) }));
  } catch {
    return { ok: false, error: DOWN };
  }
}

/** Cancel the feature's live run (the machine's own CANCEL, the same control as the Processes drawer's). */
export async function cancelRun(feature: string): Promise<boolean> {
  try {
    const body = await postJson<{ ok?: boolean }>(`${testsBase(feature)}/run/cancel`, {});
    return !!body.ok;
  } catch {
    return false;
  }
}
