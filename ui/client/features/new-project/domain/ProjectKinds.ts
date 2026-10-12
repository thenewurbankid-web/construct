// Pure (DOMAIN-001): the kinds of project New project offers, in plain words. The first is recommended and chosen to
// start with; the rest sit under More options.
import type { NewProjectFramework } from '../types.ts';

export const PROJECT_KINDS: ReadonlyArray<{ id: NewProjectFramework; label: string; sentence: string }> = [
  { id: 'line', label: 'Line project', sentence: 'Starts with a small library and one empty part, every change checked.' },
  { id: 'nextjs', label: 'Website (Next.js)', sentence: 'An empty Next.js website.' },
  { id: 'react-spa', label: 'React app', sentence: 'An empty React app that runs in the browser.' },
];

/** What a Line project starts with when the person does not say: one empty part of the app called "home". */
export const DEFAULT_FIRST_FEATURE = 'home';

export const kindLabel = (f: NewProjectFramework): string => PROJECT_KINDS.find((k) => k.id === f)?.label ?? f;
