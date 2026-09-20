// Public API for feature: processes

/** Process, step, log and artifact shapes served by /api/processes. */
export type * from './types';

/** The Processes tab body: list, detail, controls, live log, read-only artifacts. */
export * from './controllers/ProcessesController';

/** Keeps every process for the current project live over the read-only socket. */
export * from './hooks/useProcesses';

/** Keeps the list current: initial read plus the socket, reconnecting when it drops. */
export * from './hooks/useProcessesLive';
