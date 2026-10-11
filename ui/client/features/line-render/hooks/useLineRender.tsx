'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { propValueFromInput } from '../domain/PropInput';
import { propRows } from '../domain/PropRows';
import { componentName } from '../domain/RenderName';
import { stateProps } from '../domain/RenderState';
import { renderComponent } from '../workflows/RenderFlow';
import type { LineRenderState, LineRenderView, PropValue, RenderProp } from '../types';

const RERENDER_DELAY_MS = 250;

/** One library component rendered alone (GET /api/line/render). Changing a prop value renders it again with that
 * value, shortly after the last keystroke; an answer that arrives after a newer request is dropped. A new `file`
 * starts again from the component's sample props. */
export function useLineRender(file: string): LineRenderView {
  const [state, setState] = useState<LineRenderState>({ phase: 'loading' });
  const [edits, setEdits] = useState<Record<string, PropValue>>({});
  const [inputs, setInputs] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setEdits({});
    setInputs({});
    setState({ phase: 'loading' });
  }, [file]);

  useEffect(() => {
    const mine = ++seq.current;
    const run = async () => {
      setBusy(true);
      const next = await renderComponent(file, edits);
      if (mine !== seq.current) return;
      setState(next);
      setBusy(false);
    };
    const timer = window.setTimeout(() => void run(), Object.keys(edits).length === 0 ? 0 : RERENDER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [file, edits]);

  const setProp = useCallback((prop: RenderProp, raw: string | boolean) => {
    setInputs((now) => ({ ...now, [prop.name]: raw }));
    const value = propValueFromInput(prop.kind, raw);
    if (value !== null) setEdits((now) => ({ ...now, [prop.name]: value }));
  }, []);

  return { name: componentName(file), state, rows: propRows(stateProps(state), inputs), busy, setProp };
}
