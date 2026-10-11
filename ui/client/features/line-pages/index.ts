// Public API for feature: line-pages

/** The Line contract shapes the Pages screen uses (a typed mirror of packages/engine/line/contract.mjs). */
export type * from './types';

/** /pages: the Line Pages screen for a Line project, today's Pages editor for any other. */
export * from './controllers/PagesScreenController';

/** The Line Pages screen's state (feature, pages, parts, Save), for reuse or tests. */
export * from './hooks/usePagesScreen';

/** The Line Pages view over a project already read (feature and page in the URL, parts, Save). */
export * from './hooks/useLinePages';

/** Reads the open project's Line view; "not-line" when it is not a Line project. */
export * from './hooks/useLineProject';
