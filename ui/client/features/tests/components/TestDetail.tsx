import type { CodeView, GeneratedTest, InlinePart, YourTest } from '../types';

const Inline = ({ parts }: { parts: InlinePart[] }) => (
  <>
    {parts.map((p, i) => (p.kind === 'em' ? <em key={i}>{p.text}</em> : p.kind === 'code' ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
  </>
);

type TestDetailProps = {
  test: GeneratedTest | YourTest | null;
  title: string;
  steps: InlinePart[][];
  code: CodeView;
  onClone: (file: string) => void;
  onEditStep: (file: string, step: number) => void;
  onShowCode: () => void;
  onHideCode: () => void;
  onEditSteps: (file: string) => void;
};

/** Tools pane, Test tab: one test. A generated test is read-only, says so in words, and every way of changing it
 * (Clone to edit, or Edit on a step) opens the clone dialog instead of failing. */
export function TestDetail({ test, title, steps, code, onClone, onEditStep, onShowCode, onHideCode, onEditSteps }: TestDetailProps) {
  if (!test) return <p className="hint ts-pad" data-testid="test-empty">Select a test in the Browser, or a covered scenario, to see what it does.</p>;
  const locked = test.area === 'generated';
  const clonedFrom = test.area === 'yours' ? test.clonedFrom : null;
  return (
    <div className="ts-detail" data-testid="test-detail">
      <div className="ts-detail-head">
        <h3 className="ts-detail-title" title={title}>{title}</h3>
        {locked ? <span className="ts-chip ts-chip--locked" data-testid="detail-lock">Locked</span> : <span className="ts-chip ts-chip--yours" data-testid="detail-yours">{test.area === 'yours' && test.kind === 'clone' ? 'Clone' : 'Yours'}</span>}
      </div>
      <p className="ts-path" data-testid="detail-path">{test.path}</p>
      {locked ? (
        <div className="ts-banner ts-banner--warn" data-testid="detail-notice">
          <h3>Generated: read-only</h3>
          <p>Construct writes this from the flow and rewrites it whenever the flow changes. Editing it would be lost. Clone it to make it yours.</p>
        </div>
      ) : (
        <p className="hint" data-testid="detail-yours-note">
          {clonedFrom ? <>Cloned from <span className="ts-mono">{clonedFrom.file.split('/').pop()}</span>. Nothing regenerates this file.</> : 'Written by you. Nothing regenerates this file.'}
        </p>
      )}
      <div className="ts-actions">
        {!locked && <button type="button" className="ts-btn ts-btn--primary" data-testid="detail-edit-steps" onClick={() => onEditSteps(test.name)}>Edit steps</button>}
        {locked && <button type="button" className="ts-btn ts-btn--primary" data-testid="detail-clone" onClick={() => onClone(test.name)}>Clone to edit</button>}
        {code.status === 'ready' ? (
          <button type="button" className="ts-btn" data-testid="detail-hide-code" onClick={onHideCode}>Hide code</button>
        ) : (
          <button type="button" className="ts-btn" data-testid="detail-show-code" onClick={onShowCode} disabled={code.status === 'loading'}>Show code</button>
        )}
      </div>
      {code.status === 'error' && <p className="ts-err" role="alert">{code.message}</p>}
      {code.status === 'ready' && <pre className="ts-pre" data-testid="detail-code" aria-label={`Code of ${code.path}, read-only`} tabIndex={0}>{code.text}</pre>}
      {locked && steps.length > 0 && (
        <div>
          <h4 className="ts-h">What it does</h4>
          <ol className="ts-steps" data-testid="detail-steps">
            {steps.map((parts, i) => (
              <li key={i} className="ts-step">
                <span className="ts-step-text"><Inline parts={parts} /></span>
                {locked && (
                  <button type="button" className="ts-step-edit" data-testid="step-edit" aria-label={`Edit step ${i + 1}`} onClick={() => onEditStep(test.name, i + 1)}>Edit</button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div>
        <h4 className="ts-h">Last run</h4>
        <p className="hint" data-testid="detail-last-run">Not run yet.</p>
      </div>
      {locked && <p className="ts-readonly" data-testid="detail-readonly-footer">Read-only: this test is rewritten whenever the flow changes.</p>}
    </div>
  );
}
