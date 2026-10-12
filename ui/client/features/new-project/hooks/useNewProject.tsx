'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createActor } from 'xstate';
import { canCreateProject } from '../domain/NewProjectName';
import { canCreateLineProject } from '../domain/LineProjectFields';
import { createLineProject, createProject } from '../services/NewProjectApi';
import { formStateOf, newProjectMachine } from '../workflows/NewProject';
import type { NewProjectFramework, NewProjectStep } from '../types';

/** The New project form: ask the server for a folder with this name and hand the new project's folder to
 * `onCreated` (the Open-a-project screen opens it, as it does for a clone). */
export function useNewProject(onCreated: (dir: string) => void) {
  const actor = useMemo(() => createActor(newProjectMachine).start(), []);
  // useSyncExternalStore needs the same object back until the machine changes, else React re-renders forever.
  const read = useMemo(() => {
    let snapshot: ReturnType<typeof actor.getSnapshot> | null = null;
    let form: ReturnType<typeof formStateOf> | null = null;
    return () => {
      const next = actor.getSnapshot();
      if (next !== snapshot || form === null) {
        snapshot = next;
        form = formStateOf(next);
      }
      return form;
    };
  }, [actor]);
  const state = useSyncExternalStore(
    useCallback((onChange) => {
      const sub = actor.subscribe(onChange);
      return () => sub.unsubscribe();
    }, [actor]),
    read,
    read,
  );

  const create = useCallback(async () => {
    const isLine = state.framework === 'line';
    if (isLine ? !canCreateLineProject(state.name, state.firstFeature, state.parentDir, state.creating) : !canCreateProject(state.name, state.creating)) return;
    actor.send({ type: 'START' });
    const r = isLine
      ? await createLineProject(state.parentDir.trim(), state.name.trim(), state.firstFeature.trim())
      : await createProject(state.name.trim(), state.framework);
    if (r.ok) {
      actor.send({ type: 'CREATED' });
      onCreated(r.dir);
    } else actor.send({ type: 'REFUSED', error: r.error });
  }, [actor, state.name, state.framework, state.firstFeature, state.parentDir, state.creating, onCreated]);

  return {
    state,
    setName: (name: string) => actor.send({ type: 'SET_NAME', name }),
    setFramework: (framework: NewProjectFramework) => actor.send({ type: 'SET_FRAMEWORK', framework }),
    setFirstFeature: (firstFeature: string) => actor.send({ type: 'SET_FEATURE', firstFeature }),
    setParentDir: (parentDir: string) => actor.send({ type: 'SET_PARENT', parentDir }),
    next: () => actor.send({ type: 'NEXT' }),
    back: () => actor.send({ type: 'BACK' }),
    goTo: (step: NewProjectStep) => actor.send({ type: 'GO', step }),
    create,
  };
}
