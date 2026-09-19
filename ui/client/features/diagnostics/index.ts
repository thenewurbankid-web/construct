// Public API for feature: diagnostics

/** Violation, log-entry and state types. */
export type * from './types';

/** Diagnostics tab body: `construct validate` results in plain language. */
export * from './controllers/DiagnosticsController';

/** Logs tab body: recent server/command output. */
export * from './controllers/LogsController';

/** Runs validate for the current project (auto-run + on demand). */
export * from './hooks/useDiagnostics';

/** Polls recent server/command output while the Logs tab is open. */
export * from './hooks/useLogs';

/** Tab badge and status-bar text derived from a validate run. */
export * from './domain/DiagnosticsSummary';
