// Public API for feature: line-fix
import { createElement } from 'react';
import { LineFixNotice as Notice } from './components/LineFixNotice';
import type { ApplyResult } from './types';

/** A finding's typed fixes and the ApplyResult (from the shared Line mirror), and the panel's view models. */
export type * from './types';

/** Drop under any Line finding: the recommended fix with Apply, other ways under a disclosure, advice as text. */
export * from './controllers/LineFixController';

/** The screen's sentence of the last fix ("Saved. ..." / "Nothing was saved: ..."); stays after the problem leaves. */
export function LineFixNotice(props: { result: ApplyResult | null }) {
  return createElement(Notice, props);
}

/** A screen's notice state for its fix panels (every answer is the notice; a landed one calls onLanded). */
export * from './hooks/useLineFixNotice';

/** One finding's fixes and Apply, for a screen that lays the panel out itself. */
export * from './hooks/useLineFix';

/** A finding's fixes laid out (recommended, others), and any server answer as one ApplyResult. */
export * from './domain/FixOptions';
