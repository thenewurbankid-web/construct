import { Button } from '@/components/ui';
import type { DebugViewModel } from '../types';
import type { StepId } from '../domain/DebugTypes';
import { ApproveBar } from '../components/ApproveBar';
import { ChooserCard } from '../components/ChooserCard';
import { VerifyPrompt } from '../components/VerifyPrompt';

export type DebugPageProps = {
  view: DebugViewModel;
  onFeature: (feature: string) => void;
  onStart: () => void;
  onAnswer: (chooser: StepId, option: string) => void;
  onApprove: () => void;
  onOpenProcesses: () => void;
  onVerifyResult: (passed: boolean) => void;
};

/** The Debug screen (`/debug`): reproduce -> isolate -> fix -> verify, one closed question at a time (LIN-137, part
 * of LIN-82/epic #616). No model is used to pick an option: every option is a fixed, existing flow. */
export function DebugPage({ view, onFeature, onStart, onAnswer, onApprove, onOpenProcesses, onVerifyResult }: DebugPageProps) {
  return (
    <div className="dbg-stage" data-testid="debug-stage">
      <div className="dbg-toolbar">
        <h1 className="dbg-h1">Debug</h1>
        <p className="dbg-lede" data-testid="debug-no-model">No model picks an option: every option is a fixed, existing flow. debug.fix's "Fill with AI" fills a reviewable diff.</p>
      </div>
      <section className="dbg-card" aria-labelledby="dbg-feature-h">
        <h2 className="dbg-h2" id="dbg-feature-h">What are you debugging?</h2>
        <div className="dbg-field">
          <label className="dbg-label" htmlFor="dbg-feature">Feature</label>
          <input
            id="dbg-feature"
            className="dbg-text"
            type="text"
            value={view.feature}
            onChange={(e) => onFeature(e.target.value)}
            data-testid="debug-feature"
          />
        </div>
        <div className="dbg-row">
          <Button type="button" disabled={!view.canStart} onClick={onStart} data-testid="debug-start">
            {view.read.status === 'loading' && view.steps.length === 0 ? 'Reading...' : 'Start'}
          </Button>
        </div>
        {view.read.error && <p className="dbg-error" role="alert" data-testid="debug-error">{view.read.error}</p>}
      </section>

      {view.steps.map((step) => (
        <ChooserCard key={step.id} step={step} onAnswer={onAnswer} />
      ))}

      <ApproveBar plan={view.plan} compileError={view.compileError} approve={view.approve} onApprove={onApprove} onOpenProcesses={onOpenProcesses} />
      <VerifyPrompt visible={view.verifyPrompt} passed={view.verifyPassed} iterations={view.iterations} onResult={onVerifyResult} />
    </div>
  );
}
