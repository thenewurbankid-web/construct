'use client';

import { useLineWorkspace } from '@/lib/lineWorkspace';
import { useMemo } from 'react';
import { withPlan } from '../services/LinePagesApi';
import type { LinePagesApi, LinePagesPlan, LineProject } from '../types';
import { useLinePages } from './useLinePages';

/** /pages, Under the hood: the Line Pages view over a project already read (feature and page from the URL, read once
 * on mount, so the two-modes frame remounts it to open where the chat is). Its writes are steps of the project's plan
 * (`plan`: the Plan panel's addStep and the step the person last ran). `ready` is false until the URL has been read. */
export function usePagesScreen(project: LineProject, base: LinePagesApi, reload: () => Promise<void>, plan: LinePagesPlan) {
  const { addStep } = plan;
  const api = useMemo(() => withPlan(base, addStep), [base, addStep]);
  const pages = useLinePages(project, api, reload, plan.lastRun);
  const { folder } = useLineWorkspace();
  return { ready: pages.ready, view: { ...pages, workspaceFolder: folder } };
}
