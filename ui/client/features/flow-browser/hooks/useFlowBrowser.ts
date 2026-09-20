'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { hintFor } from '../domain/FlowHints';
import { relationsFor } from '../domain/FlowRelations';
import { flowRows, visibleRows } from '../domain/FlowRows';
import { fetchFlow } from '../services/FlowApi';
import type { FlowHover, FlowRow } from '../types';
import { flowBrowserReducer, initialFlowBrowser } from '../workflows/FlowBrowser';


/** The Flow view for one feature: loads its flow, keeps the selection, works out which rows the selection
 * uses / is used by, and the hover explanation. */
export function useFlowBrowser(feature: string) {
  const [state, dispatch] = useReducer(flowBrowserReducer, initialFlowBrowser);
  const [hover, setHover] = useState<FlowHover | null>(null);

  useEffect(() => {
    if (!feature) return;
    let cancelled = false;
    dispatch({ type: 'LOADING' });
    fetchFlow(feature)
      .then((data) => !cancelled && dispatch({ type: 'LOADED', data }))
      .catch((e: Error) => !cancelled && dispatch({ type: 'FAILED', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [feature]);

  const data = state.load.status === 'ready' ? state.load.data : null;
  const rows = useMemo(() => (data ? flowRows(data) : []), [data]);
  const shown = useMemo(() => visibleRows(rows, state.collapsed), [rows, state.collapsed]);
  const relations = useMemo(() => relationsFor(rows, state.selectedId), [rows, state.selectedId]);

  const select = useCallback((id: string) => dispatch({ type: 'SELECT', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'TOGGLE', id }), []);
  const showHint = useCallback(
    (row: FlowRow, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setHover({ row, hint: hintFor(row, rows), x: r.left + 24, y: r.bottom + 4 });
    },
    [rows],
  );
  const hideHint = useCallback(() => setHover(null), []);

  return { load: state.load, data, shown, selectedId: state.selectedId, collapsed: state.collapsed, relations, hover, select, toggle, showHint, hideHint };
}
