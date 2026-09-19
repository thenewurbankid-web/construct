'use client';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { PaneId } from '../types';

type Reveal = (pane: PaneId) => void;
const RevealContext = createContext<Reveal>(() => {});

/** Lets a feature open a collapsed pane (e.g. the Tools panel when a workflow
 * loads and its tabs become useful). Mounted by the shell; a no-op outside it. */
export function PaneRevealProvider({ reveal, children }: { reveal: Reveal; children: ReactNode }) {
  return createElement(RevealContext.Provider, { value: reveal }, children);
}

export function useRevealPane(): Reveal {
  return useContext(RevealContext);
}
