'use client';

import Link from 'next/link';
import { Button, GlassPanel } from '@/components/ui';
import type { ProjectStatus } from '../types';

type ProjectGateScreenProps = {
  status: ProjectStatus;
  initializing: boolean;
  error: string | null;
  onInit: () => void;
};

/** Presentation-only "no Construct project here yet" screen — identical
 * markup/classes to the original ProjectGate.jsx so ui/e2e's Playwright
 * suite (which locates it by heading text, the "Initialize Construct here"
 * button, and the first <code> element) keeps passing unchanged. */
export function ProjectGateScreen({ status, initializing, error, onInit }: ProjectGateScreenProps) {
  return (
    <div className="page">
      <GlassPanel className="gate-panel">
        <h1>No Construct project here yet</h1>
        <p className="hint">
          The selected project directory — <code>{status.projectDir}</code> — doesn&apos;t look like a
          Construct project: no <code>architecture.yml</code> was found there or in any parent directory.
        </p>
        <p>
          Pick a different, existing project in <Link href="/settings">Settings</Link>, or initialize a
          new one right here:
        </p>
        <Button onClick={onInit} disabled={initializing}>
          {initializing ? 'Initializing…' : 'Initialize Construct here'}
        </Button>
        {error && <p className="status-error">{error}</p>}
      </GlassPanel>
    </div>
  );
}
