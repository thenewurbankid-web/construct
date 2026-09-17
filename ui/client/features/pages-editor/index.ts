// Public API for feature: pages-editor

/** Shared identifier, tree-node, and save-outcome types for the pages
 * editor feature (epic #48). */
export type * from './types';

/** Renders the pages browser, JSX tree, structural preview, props/snippet
 * inspector, auto-map panel, and prop-flow diagram, behind the project
 * gate. */
export * from './controllers/PagesEditorController';
export * from './hooks/useAutoMap';
export * from './hooks/usePagesEditor';
export * from './hooks/usePropFlow';
export * from './hooks/usePropRow';
export * from './hooks/useSnippetEditor';
