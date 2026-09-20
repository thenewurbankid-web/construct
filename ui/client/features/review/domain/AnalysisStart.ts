// Pure (DOMAIN-001): when does the screen ask for an analysis, and when does it keep waiting for one (#351).
// A cancelled analysis is a stop the person asked for: it is only run again when they ask again.
import type { BranchRow } from '../types.ts';

/** Ask for the analysis of one change? A new one (none), a failed one (error), or a cancelled one only when re-asked. */
export const shouldStart = (state: string, forced: boolean): boolean => state === 'none' || state === 'error' || (forced && state === 'cancelled');

/** Is an analysis still on its way (so the screen should keep reading)? */
export const isLive = (state: string): boolean => state === 'none' || state === 'queued' || state === 'running' || state === 'paused';

/** The branches whose analysis the list should request: the new ones, and the cancelled ones when re-analysing. */
export const headsToStart = (branches: BranchRow[], forced: boolean): string[] =>
  branches.filter((b) => b.analysis.state === 'none' || (forced && b.analysis.state === 'cancelled')).map((b) => b.name);
