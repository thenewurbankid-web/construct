// Public API for feature: workflows

/** Extracted-machine and browsing-state types for the Workflows screen
 * (epic #57). */
export type * from './types';

/** Renders the Workflows screen — a feature's workflows/ layer files and
 * each real XState machine as a diagram — behind the project gate. */
export * from './controllers/WorkflowsController';

/** Top-level feature -> file -> machines browsing state; used by
 * WorkflowsController, exported for direct reuse/testing. */
export * from './hooks/useWorkflows';

/** React Flow nodes/edges derived from one extracted machine. */
export * from './hooks/useMachineFlow';

/** Plain-English narrative/scenarios/health for the open file (epic #185). */
export * from './hooks/useWorkflowNarrative';

/** Visual edit flow (propose diff -> confirm save) used by useWorkflows (#61). */
export * from './hooks/useWorkflowEditor';

/** Which machine/arrow/event name the diagram and the tools tabs share. */
export * from './hooks/useCanvasSelection';

/** Refit the diagram when its box resizes (panes opening or dragged). */
export * from './hooks/useFitOnResize';

/** The before/after diff and its Confirm / Cancel step, reused wherever a whole-file edit is reviewed before it is written (#431). */
export * from './components/WorkflowDiffPreview';
export * from './domain/SourceDiff';
