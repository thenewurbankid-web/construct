// Public API for feature: line-knows ("What Line knows", the shell; each tab is its own feature)

/** The shell's view shapes and the page's one contract mirror (lib/lineKnowsContract.ts). */
export type * from './types';

/** The "What Line knows" screen, for app/knows. */
export * from './controllers/LineKnowsController';

/** Hook: the open tab, the item in focus and the page's http. */
export * from './hooks/useLineKnows';

/** The four tabs and the chat's options (pure). */
export * from './domain/KnowsTabs';
