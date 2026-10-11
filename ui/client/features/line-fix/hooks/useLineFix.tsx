'use client';

import { useCallback, useMemo, useReducer, useRef } from 'react';
import { canApply, fixOptions } from '../domain/FixOptions';
import { lineFixApi } from '../services/LineFixApi';
import { applyFixReducer, idleFix, refusalOf } from '../workflows/ApplyFix';
import type { FixResultHandler, LineFinding, LineFix, LineFixApi, LineFixView } from '../types';

/** One finding's fixes and Apply. Apply sends {findingKey, fixId}; the answer goes to `onResult` (the screen shows
 * its sentence and re-reads the project). Advice-only fixes are never sent. The API is injectable for tests. */
export function useLineFix(finding: LineFinding, onResult: FixResultHandler, api: LineFixApi = lineFixApi): LineFixView {
  const [state, dispatch] = useReducer(applyFixReducer, idleFix);
  const busy = useRef(false);
  const options = useMemo(() => fixOptions(finding), [finding]);
  const key = finding.key ?? `${finding.rule}|${finding.file}|${finding.line}`;

  const apply = useCallback(
    (fix: LineFix) => {
      if (busy.current || !canApply(fix)) return;
      busy.current = true;
      dispatch({ type: 'APPLY', fixId: fix.id });
      void api.fix({ findingKey: key, fixId: fix.id }).then((result) => {
        busy.current = false;
        dispatch({ type: 'DONE', result });
        onResult(result);
      });
    },
    [api, key, onResult],
  );

  return { options, state, refusal: refusalOf(state), apply };
}
