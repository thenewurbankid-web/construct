import { Button } from '@/components/ui';
import type { DevServerHandlers, DevServerView } from '../types';

// The buttons a state offers. Which of them exist is the domain layer's answer (`canStart`, `canStop`, ...).
export function DevServerActions({ view, onStart, onStop, onRestart, onUsePort, onShowLog }: DevServerHandlers & { view: DevServerView }) {
  const { busy, usePort } = view;
  return (
    <div className="dev-server__actions">
      {view.canStart && <Button type="button" disabled={busy} onClick={onStart} data-testid="dev-server-start">{view.card === 'not-running' ? 'Start dev server' : 'Try again'}</Button>}
      {usePort !== null && <Button type="button" disabled={busy} onClick={() => onUsePort(usePort)} data-testid="dev-server-use-port">Use port {usePort}</Button>}
      {view.canRestart && <Button type="button" variant="ghost" disabled={busy} onClick={onRestart} data-testid="dev-server-restart">Restart</Button>}
      {view.canStop && <Button type="button" variant="ghost" disabled={busy} onClick={onStop} data-testid="dev-server-stop">Stop</Button>}
      {view.showLog && <Button type="button" variant="ghost" onClick={onShowLog} data-testid="dev-server-show-log">Show log</Button>}
    </div>
  );
}
