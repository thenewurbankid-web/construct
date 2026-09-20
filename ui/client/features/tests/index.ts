// Public API for feature: tests

/** Shapes of /api/tests and the Tests screen's view state (#300, #301). */
export type * from './types';

/** The Tests screen: scenario coverage, generated (locked) and your tests, and clone-to-edit. */
export * from './controllers/TestsController';

/** The step editor: open one of your tests as steps, edit, review the diff, save. */
export * from './hooks/useStepEditor';

/** The step editor's two server round trips: review the diff, then save exactly it. */
export * from './hooks/useStepReview';

/** The Tests screen's state and I/O: listing, selection, clone dialog, generate. */
export * from './hooks/useTests';

/** The feature's listing, selection and scenario coverage for one feature. */
export * from './hooks/useTestsListing';

/** "Show code": one listed test's text, read-only. */
export * from './hooks/useTestCode';

/** The clone dialog's open / edit / submit / show-code actions. */
export * from './hooks/useCloneActions';

/** What changed under the selected clone: the flow it was cloned from vs the flow now (#306). */
export * from './hooks/useCloneComparison';

/** Running the feature's tests as a process (#305): live run, latest results, cancel, copy as bug report. */
export * from './hooks/useTestRuns';
