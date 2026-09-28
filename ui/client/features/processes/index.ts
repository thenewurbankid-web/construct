// Public API for feature: processes

/** Process, step, log and artifact shapes served by /api/processes. */
export type * from './types';

/** The Processes tab body: list, detail, controls, live log, read-only artifacts. */
export * from './controllers/ProcessesController';

/** The Approvals tab body: every process with files waiting on a human (#371). */
export * from './controllers/ApprovalsController';

/** Keeps every process for the current project live over the read-only socket. */
export * from './hooks/useProcesses';

/** Keeps the list current: initial read plus the socket, reconnecting when it drops. */
export * from './hooks/useProcessesLive';

/** The approval gate's review and per-file decisions (#341). */
export * from './hooks/useReview';

/** The bottom panel's live region: process state changes announced wherever you are (#371). */
export * from './hooks/useProcessAnnouncer';
export * from './components/ProcessAnnouncer';

/** How many processes have something waiting on a human; the Approvals tab's badge (#371). */
export { pendingApprovalCount } from './domain/ApprovalRows';
export { summariesOf } from './workflows/Processes';
