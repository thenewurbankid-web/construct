// Public API for feature: line-components (cu4)

/** The Components editor's shapes (a typed mirror of packages/engine/line/components.mjs LineComponentEditor). */
export type * from './types';

/** The editor (Behaviour, Events, States) and New component, for the Components screen. */
export * from './controllers/ComponentEditorArea';

/** The editor's state and its changes as plan steps, for reuse or tests. */
export * from './hooks/useComponentEditor';
