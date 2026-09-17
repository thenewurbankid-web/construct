'use client';

import type { ReactNode } from 'react';
import { useProjectGate } from '../hooks/useProjectGate';
import { ProjectGatePage } from '../pages/ProjectGatePage';

/** Wraps a route that needs a valid Construct project (Dashboard, Wizard,
 * Pages Editor) and blocks it behind a project-selection/init screen
 * instead of letting it render against a directory that has no
 * architecture.yml above it. Every gated feature's own controller imports
 * this one from project-gate's public API (index.ts) and wraps its content
 * with it — the real, checked (SLICE-002) cross-feature dependency the
 * migration in #71 asked for. */
export function ProjectGateController({ children }: { children: ReactNode }) {
  const { status, initializing, error, handleInit } = useProjectGate();
  return (
    <ProjectGatePage status={status} initializing={initializing} error={error} onInit={handleInit}>
      {children}
    </ProjectGatePage>
  );
}
