'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadLinePagesApi } from '../services/LinePagesApi';
import type { LinePagesApi, LineProject } from '../types';

export type LineProjectState =
  | { phase: 'loading' }
  | { phase: 'not-line' }
  | { phase: 'line'; project: LineProject; api: LinePagesApi };

/** Reads the open project's Line view once. A project that is not a Line project, or a server with no
 * /api/line routes yet, is "not-line": the caller keeps today's Pages screen. `reload` reads it again after a save. */
export function useLineProject() {
  const [state, setState] = useState<LineProjectState>({ phase: 'loading' });

  const read = useCallback(async (api: LinePagesApi) => {
    try {
      const project = await api.getProject();
      setState(project && project.isLine === true && Array.isArray(project.features) ? { phase: 'line', project, api } : { phase: 'not-line' });
    } catch {
      setState({ phase: 'not-line' });
    }
  }, []);

  useEffect(() => {
    let live = true;
    loadLinePagesApi().then(
      (api) => {
        if (live) void read(api);
      },
      () => {
        if (live) setState({ phase: 'not-line' });
      },
    );
    return () => {
      live = false;
    };
  }, [read]);

  const reload = useCallback(() => (state.phase === 'line' ? read(state.api) : Promise.resolve()), [state, read]);
  return { state, reload };
}
