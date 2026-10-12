// Public API for feature: line-knows-change ("What Line knows", the Change tab; the shell is line-knows)

/** The Change tab, rendered by the line-knows shell with KnowsTabProps (lib/lineKnowsContract.ts). */
export * from './controllers/KnowsChangeTab';

/** Hook: the proposals and what the person did with each (plan it, approve). */
export * from './hooks/useKnowsChange';

/** Pure: the cards, their labels and what a run means for a card. */
export * from './domain/ChangeCards';

/** The plan calls a change makes (real plan, or mock mode's pretend plan). */
export * from './services/ChangePlanApi';
