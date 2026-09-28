// Public API for feature: generate-control

/** The slot contract types (props/events) every Generate action is built from. */
export type * from './types';

/** The `[Mechanical | AI][Generate]` control itself — presentational, states derived from props. */
export * from './components/GenerateControl';

/** Owns the remembered per-action-kind Mechanical/AI choice and the model-offline check. */
export * from './hooks/useGenerateMode';
