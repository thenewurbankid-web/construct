'use client';

import { useShellDrawer } from '@/features/shell';
import { useDevServer } from '../hooks/useDevServer';
import { useDevServerUrl } from '../hooks/useDevServerUrl';
import { DevServerPage } from '../pages/DevServerPage';

type DevServerControllerProps = {
  /** Told the server's address when it starts answering, and `null` when it is no longer running, so the
   * screen that owns the preview can point its frame at it (or let go of it). Composed in, like a slot. */
  onUrl?: (url: string | null) => void;
};

// Wires the dev-server hook to its card. Composed as a slot by the Pages editor, which knows nothing about how
// the server is started, only where it can be reached.
export function DevServerController({ onUrl }: DevServerControllerProps) {
  const dev = useDevServer();
  const drawer = useShellDrawer();
  useDevServerUrl(dev.status, onUrl);

  return (
    <DevServerPage
      view={dev.view}
      error={dev.error}
      onStart={dev.requestStart}
      onConfirm={dev.confirmStart}
      onCancel={dev.cancelConfirm}
      onStop={dev.stop}
      onRestart={dev.restart}
      onUsePort={dev.startOnPort}
      onShowLog={drawer.openLogs}
    />
  );
}
