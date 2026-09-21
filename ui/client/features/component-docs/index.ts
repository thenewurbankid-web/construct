// Public API for feature: component-docs

/** Shapes of a listed component, its props and the plain-file edit flow. */
export type * from './types';

/** The Components screen: the project's components in the Browser, the chosen one documented in the stage with its file editable. */
export * from './controllers/ComponentsController';

/** The list, description and editor hooks (used by ComponentsController; exported for direct reuse/testing). */
export * from './hooks/useComponentList';
export * from './hooks/useComponentDoc';
export * from './hooks/useComponentEditor';
