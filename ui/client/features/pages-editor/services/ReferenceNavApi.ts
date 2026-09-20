import { getJson, postJson } from '@/lib/http';
import type { NavView } from '../types';

// Server-side confinement lives in ui/server/src/projectNav.mjs: the first view is a page (pages/ guard),
// every later hop names a reference in a file and the server derives the target. Never a path to read.
export const getNavPage = (feature: string, file: string) =>
  getJson<NavView>(`/api/nav/page?feature=${encodeURIComponent(feature)}&file=${encodeURIComponent(file)}`);

export const openNavReference = (from: string, ref: string, start: number) => postJson<NavView>('/api/nav/open', { from, ref, start });
