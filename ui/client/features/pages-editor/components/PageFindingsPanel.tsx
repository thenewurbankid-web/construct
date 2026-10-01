'use client';

import type { FileFindings } from '../hooks/useFileFindings';

type PageFindingsPanelProps = { findings: FileFindings | null };

// #831 -- design 8.2's "Findings" inspector section: Review findings (prHealth, via /api/review) for the open
// page file, collapsed by default and one-line while closed, the same `.pal-group` disclosure Impact/Tests/Scope
// already use. Numbered, not colour-only (acceptance: "text-labelled, never colour only"). The numbered pin
// drawn on the live preview, and click-to-open wiring, are split to a follow-up issue: no node-rect measurement
// exists yet on the preview to anchor a pin to (see that issue for why).
export function PageFindingsPanel({ findings }: PageFindingsPanelProps) {
  const summaryText =
    findings === null ? 'checking…' : !findings.ok ? 'unknown' : !findings.ready ? 'not reviewed yet' : findings.findings.length === 0 ? '0 findings' : `${findings.findings.length} finding${findings.findings.length === 1 ? '' : 's'}`;
  return (
    <details className="findings-panel pal-group" data-testid="findings-panel">
      <summary>
        Findings <span className="pal-count" data-testid="findings-count">{summaryText}</span>
      </summary>
      {findings?.ok && !findings.ready && <p className="hint">This file hasn&apos;t been reviewed yet — run Review to see findings here.</p>}
      {findings?.ok && findings.ready && (findings.findings.length === 0 ? (
        <p className="hint">No findings for this file.</p>
      ) : (
        <ol className="findings-list" data-testid="findings-list">
          {findings.findings.map((f, i) => (
            <li key={f.id} title={f.message}>
              <span className="findings-number" aria-hidden="true">{i + 1}</span> {f.title} <span className="hint">{f.severity}</span>
            </li>
          ))}
        </ol>
      ))}
    </details>
  );
}
