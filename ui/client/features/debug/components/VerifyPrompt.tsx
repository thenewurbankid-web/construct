import { Button } from '@/components/ui';
import type { VerifyPromptProps } from '../types';

/** After debug.verify is answered and the plan runs (by hand, or through Approve above), a person marks whether the
 * check went green. "Did not pass" is debug.verify's repeat-until loop (packages/core/debug-chain.mjs's
 * `shouldReiterate`): it clears isolate, fix and verify's answers (keeping reproduce's) and re-presents the isolate
 * chooser, rather than ending the chain. This is UI/CLI state, not a new engine primitive: nothing here runs a check. */
export function VerifyPrompt({ visible, passed, iterations, onResult }: VerifyPromptProps) {
  if (!visible && !passed) return null;
  return (
    <section className="dbg-card" aria-labelledby="dbg-verify-h" data-testid="debug-verify-prompt">
      <h2 className="dbg-h2" id="dbg-verify-h">Did it go green?</h2>
      {iterations > 0 && <p className="dbg-muted" data-testid="debug-iterations">Re-isolated {iterations} time{iterations === 1 ? '' : 's'}.</p>}
      {visible && (
        <div className="dbg-row">
          <Button type="button" onClick={() => onResult(true)} data-testid="debug-verify-passed">Passed</Button>
          <Button type="button" variant="ghost" onClick={() => onResult(false)} data-testid="debug-verify-failed">Did not pass</Button>
        </div>
      )}
      {passed && <p className="dbg-ok" role="status" data-testid="debug-verify-ok">Fixed: the check went green.</p>}
    </section>
  );
}
