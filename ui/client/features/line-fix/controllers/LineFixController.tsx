'use client';

import { useLineFix } from '../hooks/useLineFix';
import { LineFixPanel } from '../pages/LineFixPanel';
import type { FixResultHandler, LineFinding, LineFixApi } from '../types';

type LineFixControllerProps = { finding: LineFinding; onResult: FixResultHandler; label?: string; api?: LineFixApi };

/** A Line problem's fixes with Apply, ready to drop under any finding (Components, Pages, Diagnostics). */
export function LineFixController({ finding, onResult, label = 'How to fix it', api }: LineFixControllerProps) {
  return <LineFixPanel view={useLineFix(finding, onResult, api)} label={label} />;
}
