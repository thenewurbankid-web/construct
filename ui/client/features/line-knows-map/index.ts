// Public API for feature: line-knows-map ("What Line knows", the Map tab; the shell is line-knows)

/** The Map tab, rendered by the line-knows shell with KnowsTabProps (lib/lineKnowsContract.ts). */
export * from './controllers/KnowsMapTab';

/** Hook: the Map tab's state (graph read, layers, who uses / what breaks). */
export * from './hooks/useKnowsMap';

/** Pure: the Map's sentences, start points, layer filter and dagre picture. */
export * from './domain/MapSentences';
export * from './domain/MapItems';
export * from './domain/MapLayout';
