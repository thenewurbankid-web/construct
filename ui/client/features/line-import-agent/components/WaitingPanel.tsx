import { StreamedText } from '@/lib/StreamedText';
import type { AgentActions, AgentScreen } from '../types';
import { AgentQuestion } from './AgentQuestion';

type WaitingPanelProps = { screen: AgentScreen; busy: boolean; error: string | null; actions: AgentActions };

/** Where the process is in one sentence, and the one thing to do now: approve the plan, approve the next change, answer
 * the question, or resume. A refused call is said in one sentence. */
export function WaitingPanel({ screen, busy, error, actions }: WaitingPanelProps) {
  const label = busy ? 'Working…' : screen.main?.label;
  return (
    <section className="la-card la-now" aria-labelledby="la-now-h" hidden={!screen.started && !error}>
      <h2 id="la-now-h" className="la-h2">Now</h2>
      <div role="status" aria-live="polite">
        <StreamedText text={screen.sentence ?? ''} className="la-sentence" testId="la-sentence" />
        <p className="la-hint" hidden={!screen.message}>{screen.message}</p>
        <p className="la-error" data-testid="la-error" hidden={!error}>{error}</p>
      </div>
      <AgentQuestion question={screen.question} busy={busy} onAnswer={actions.answer} />
      <div className="la-row">
        <button type="button" className="la-btn la-btn--primary" disabled={busy} onClick={actions.runMain} data-testid="la-main" hidden={!screen.started || !screen.main}>{label}</button>
        <button type="button" className="la-btn" disabled={busy} onClick={actions.pause} hidden={!screen.canPause}>Pause</button>
      </div>
    </section>
  );
}
