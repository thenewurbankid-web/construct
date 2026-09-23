import { Button } from '@/components/ui';

type DevServerConfirmProps = { busy: boolean; onConfirm: () => void; onCancel: () => void };

// Asked once per project and command: starting a dev server runs the project's own code, so the exact command
// (shown right above, in the card) is seen before it is ever run.
export function DevServerConfirm({ busy, onConfirm, onCancel }: DevServerConfirmProps) {
  return (
    <div className="dev-server__confirm" role="group" aria-label="Confirm the command">
      <p className="hint">Starting a dev server runs your project&apos;s own code on this machine. Run it?</p>
      <div className="dev-server__actions">
        <Button type="button" disabled={busy} onClick={onConfirm} data-testid="dev-server-confirm">Run it</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel} data-testid="dev-server-cancel">Cancel</Button>
      </div>
    </div>
  );
}
