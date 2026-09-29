'use client';

// #748 (R6) -- the screen: table view of the spec next to the read-back and a diff against the original
// requirement, each function row offering View/edit code and Fill with AI, a Generate bar for the golden path
// (approve a spec, see it generate).
import { SpecTable } from '../components/SpecTable';
import { ReadBackPanel } from '../components/ReadBackPanel';
import type { useSpecBreakdown } from '../hooks/useSpecBreakdown';
import '../components/spec-breakdown.css';

type Props = ReturnType<typeof useSpecBreakdown> & { file: string; feature: string };

export function SpecBreakdownPage({ file, feature, report, readBack, error, loading, generate, generating, generateResult, fillWithAi, fill, viewCode, codeView, closeCodeView }: Props) {
  return (
    <div className="sb-page" data-testid="sb-page">
      <h2>Break down into functions</h2>
      <p className="sb-file" data-testid="sb-file">{file}</p>
      {loading && <p data-testid="sb-loading">Loading…</p>}
      {error && <p className="sb-error" role="alert" data-testid="sb-error">{error}</p>}
      {report && report.status !== 'passed' && (
        <div className="sb-violations" data-testid="sb-violations">
          <p>This spec is not accepted yet: {report.violations.length} violation(s).</p>
          <ul>
            {report.violations.map((v, i) => (
              <li key={i}>
                <code>{v.rule}</code>: {v.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report && report.status === 'passed' && readBack && (
        <>
          <div className="sb-generate-bar" data-testid="sb-generate-bar">
            <button type="button" className="dg-btn" disabled={generating} onClick={() => generate(feature)} data-testid="sb-generate">
              {generating ? 'Generating…' : 'Generate'}
            </button>
            {generateResult && (
              <span data-testid="sb-generate-result">
                {generateResult.written.length} file(s) written, {generateResult.skipped.length} skipped.
              </span>
            )}
          </div>
          <div className="sb-columns">
            <SpecTable
              readBack={readBack}
              feature={feature}
              generated={!!generateResult}
              onViewCode={(name) => viewCode(feature, name)}
              onFillWithAi={(name) => fillWithAi(name, feature)}
              fillBusyFor={fill?.busy ? fill.name : null}
            />
            <ReadBackPanel readBack={readBack} />
          </div>
          {fill && !fill.busy && (
            <p className={`sb-fill-result ${fill.ok ? 'ok' : 'error'}`} data-testid="sb-fill-result">
              {fill.name}: {fill.message}
            </p>
          )}
          {codeView && (
            <div className="sb-code-view" data-testid="sb-code-view">
              <div className="sb-code-view-head">
                <strong>{codeView.name}</strong>
                <button type="button" className="dg-btn" onClick={closeCodeView} data-testid="sb-code-view-close">Close</button>
              </div>
              {'source' in codeView ? <pre data-testid="sb-code-view-source">{codeView.source}</pre> : <p className="sb-error" role="alert">{codeView.error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
