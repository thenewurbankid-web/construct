// Public API for feature: line-fix

/** A finding's typed fixes and the ApplyResult (from the shared Line mirror), and the panel's view models. */
export type * from './types';

/** Drop under any Line finding: the recommended fix with Apply, other ways under a disclosure, advice as text. */
export * from './controllers/LineFixController';

/** The screen's sentence of the last fix ("Saved. ..." / "Nothing was saved: ..."); stays after the problem leaves. */
export * from './components/LineFixNotice';

/** A finding's fixes laid out (recommended, others), and any server answer as one ApplyResult. */
export * from './domain/FixOptions';
