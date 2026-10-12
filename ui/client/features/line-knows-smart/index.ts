// Public API for feature: line-knows-smart ("What Line knows", the How smart is it tab; the shell is line-knows)

/** The How smart is it tab, rendered by the line-knows shell with KnowsTabProps (lib/lineKnowsContract.ts). */
export * from './controllers/KnowsSmartTab';

/** Hook: the numbers as cards, and the click to the items behind one. */
export * from './hooks/useKnowsSmart';

/** Pure: a number as a card, its trend in words, the tab grouped. */
export * from './domain/SmartCards';
