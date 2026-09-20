import { useState } from 'react';
import type { RunOutcome } from '../types';

type RunFailureProps = {
  outcome: RunOutcome;
  copied: string | null;
  onCopy: (key: string, text: string) => Promise<boolean>;
  /** Prefix of the test ids, so the same card can appear in the stage and in the Tools pane without clashing. */
  prefix?: string;
};

const where = (step: { n: number; sentence: string } | null) => (step ? `Step ${step.n}: ${step.sentence}` : null);

/** One failed test, explained. The two kinds are told apart in words (never colour alone): a CONVENTION failure is the
 * test harness's problem, in the generator's own sentence, and is not offered as a bug report; an APP failure says what
 * was expected and what the flow reached, and is. Everything shown is selectable text, so it can be pasted into a note. */
export function RunFailure({ outcome, copied, onCopy, prefix = '' }: RunFailureProps) {
  const f = outcome.failure;
  const [manual, setManual] = useState(false);
  if (!f) return null;
  const key = `${outcome.area}/${outcome.file}/${outcome.title}`;
  if (f.kind === 'convention') {
    return (
      <section className="ts-banner ts-banner--warn ts-fail" data-testid={`${prefix}failure-convention`} aria-label={`Why "${outcome.title}" failed`}>
        <h3><span aria-hidden="true">⚠ </span>Harness problem, not a product bug</h3>
        <p>The page never got as far as behaving wrongly. The test looked for something the flow says should be there, and it is not.</p>
        <dl className="ts-facts">
          {where(f.step) && <><dt>Where</dt><dd data-testid={`${prefix}failure-step`}>{where(f.step)}</dd></>}
          {f.event && <><dt>Event</dt><dd className="ts-mono">{f.event}</dd></>}
          <dt>Expected</dt><dd className="ts-mono" data-testid={`${prefix}failure-selector`}>{f.selector}</dd>
          {f.page && <><dt>Page</dt><dd className="ts-mono" data-testid={`${prefix}failure-page`}>{f.page}</dd></>}
        </dl>
        <pre className="ts-pre" data-testid={`${prefix}failure-message`} tabIndex={0} aria-label="What the test said, as text">{f.message}</pre>
        <p><strong>How to fix it.</strong> <span data-testid={`${prefix}failure-fix`}>{f.fix}</span></p>
      </section>
    );
  }
  if (f.kind === 'app') {
    return (
      <section className="ts-banner ts-banner--error ts-fail" data-testid={`${prefix}failure-app`} aria-label={`Why "${outcome.title}" failed`}>
        <h3><span aria-hidden="true">✗ </span>The app behaved differently</h3>
        <p data-testid={`${prefix}failure-summary`}>{f.summary}</p>
        <dl className="ts-facts">
          {where(f.step) && <><dt>Where</dt><dd>{where(f.step)}</dd></>}
          <dt>Expected</dt><dd className="ts-mono">{f.expected}</dd>
          <dt>Reached</dt><dd className="ts-mono">{f.reached}</dd>
          {f.page && <><dt>Page</dt><dd className="ts-mono">{f.page}</dd></>}
        </dl>
        <p>The test found its buttons and pages, so this one is worth a bug report.</p>
        {f.bugReport && (
          <div className="ts-actions">
            <button type="button" className="ts-btn ts-btn--primary" data-testid={`${prefix}copy-bug-report`} onClick={async () => { if (!(await onCopy(key, f.bugReport as string))) setManual(true); }}>Copy as bug report</button>
            {copied === key && <span className="hint" role="status" data-testid={`${prefix}copied`}>Copied. Paste it into your notes.</span>}
          </div>
        )}
        {f.bugReport && (manual || copied === key) && <pre className="ts-pre" data-testid={`${prefix}bug-report-text`} tabIndex={0} aria-label="Bug report, as text">{f.bugReport}</pre>}
        {manual && copied !== key && <p className="hint" role="status">Your browser did not allow copying. Select the text above and copy it.</p>}
      </section>
    );
  }
  return (
    <section className="ts-banner ts-fail" data-testid={`${prefix}failure-other`} aria-label={`Why "${outcome.title}" failed`}>
      <h3>The test could not finish</h3>
      <p>Neither the test setup nor the app is blamed here: this is what happened, as it was reported.</p>
      <pre className="ts-pre" data-testid={`${prefix}failure-message`} tabIndex={0} aria-label="What the test said, as text">{f.message}</pre>
    </section>
  );
}
