'use client';

import { useCallback, useReducer } from 'react';
import { canCreateProject } from '../domain/NewProjectName';
import { createProject } from '../services/NewProjectApi';
import { initialNewProjectState, newProjectReducer } from '../workflows/NewProject';
import type { NewProjectFramework } from '../types';

/** The New project form: ask the server for a folder with this name and hand the new project's folder to
 * `onCreated` (the Open-a-project screen opens it, as it does for a clone). */
export function useNewProject(onCreated: (dir: string) => void) {
  const [state, dispatch] = useReducer(newProjectReducer, initialNewProjectState);

  const create = useCallback(async () => {
    if (!canCreateProject(state.name, state.creating)) return;
    dispatch({ type: 'START' });
    const r = await createProject(state.name.trim(), state.framework);
    if (r.ok) onCreated(r.dir);
    else dispatch({ type: 'REFUSED', error: r.error });
  }, [state.name, state.framework, state.creating, onCreated]);

  return {
    state,
    setName: (name: string) => dispatch({ type: 'SET_NAME', name }),
    setFramework: (framework: NewProjectFramework) => dispatch({ type: 'SET_FRAMEWORK', framework }),
    create,
  };
}
