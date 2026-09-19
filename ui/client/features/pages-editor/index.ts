// Public API for feature: pages-editor

/** Shared identifier, tree-node, and save-outcome types for the pages
 * editor feature (epic #48). */
export type * from './types';

/** Renders the pages browser, JSX tree, structural preview, props/snippet
 * inspector, auto-map panel, and prop-flow diagram, behind the project
 * gate. */
export * from './controllers/PagesEditorController';

/** Finds and wires unmapped child props onto a parent component (#54). */
export * from './hooks/useAutoMap';

/** Polls for a page file's last external (on-disk) change and exposes it as a diff (#224). */
export * from './hooks/usePageChange';

/** Backs the top-level pages browser/tree/selection state — used by
 * PagesEditorController; exported for direct reuse/testing. */
export * from './hooks/usePagesEditor';

/** Derives the prop-flow diagram's layout/edges/legend from a parsed tree (#55). */
export * from './hooks/usePropFlow';

/** The selected element's scope/binding link view model: which page-scope
 * names flow into which of its props, and which props are unbound (#223). */
export * from './hooks/useScopeLinks';

/** One prop's edit/save state, used by the PropRow component (#53). */
export * from './hooks/usePropRow';

/** One node's isolated snippet edit/save-back state, including JSX syntax
 * highlighting and a diff preview shown before a save is confirmed (#52,
 * #81). */
export * from './hooks/useSnippetEditor';

/** Derives the visual composer's React Flow node/edge graph from a
 * snippet's live-parsed source (#120, epic #119). */
export * from './hooks/useSnippetFlow';

/** Loads a page's full source and its TypeScript/architecture diagnostics as
 * editor-neutral markers (read-only source view). */
export * from './hooks/usePageSource';
