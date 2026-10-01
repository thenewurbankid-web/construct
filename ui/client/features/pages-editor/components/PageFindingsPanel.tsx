'use client';

import { useEffect, useRef } from 'react';
import type { FileFindings } from '../hooks/useFileFindings';

type PageFindingsPanelProps = {
  findings: FileFindings | null;
  /** #835 -- the finding id a live-preview pin was just clicked for: opens this panel and scrolls to it. */
  openId?: string | null;
};

// #831 -- design 8.2's "Findings" inspector section: Review findings (prHealth, via /api/review) for the open
// page file, collapsed by default and one-line while closed, the same `.pal-group` disclosure Impact/Tests/Scope
// already use. Numbered, not colour-only (acceptance: "text-labelled, never colour only"). #835 added the
// live-preview pin (LivePreviewPanel's `pins`/`onPinClick`, usePagesEditorTabs wires a click here).
export function PageFindingsPanel({ findings, openId = null }: PageFindingsPanelProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!openId) return;
    if (detailsRef.current) detailsRef.current.open = true;
    itemRefs.current.get(openId)?.scrollIntoView({ block: 'nearest' });
  }, [openId, findings]);

  const summaryText =
    findings === null ? 'checking…' : !findings.ok ? 'unknown' : !findings.ready ? 'not reviewed yet' : findings.findings.length === 0 ? '0 findings' : `${findings.findings.length} finding${findings.findings.length === 1 ? '' : 's'}`;
  return (
    <details ref={detailsRef} className="findings-panel pal-group" data-testid="findings-panel">
      <summary>
        Findings <span className="pal-count" data-testid="findings-count">{summaryText}</span>
      </summary>
      {findings?.ok && !findings.ready && <p className="hint">This file hasn&apos;t been reviewed yet — run Review to see findings here.</p>}
      {findings?.ok && findings.ready && (findings.findings.length === 0 ? (
        <p className="hint">No findings for this file.</p>
      ) : (
        <ol className="findings-list" data-testid="findings-list">
          {findings.findings.map((f, i) => (
            <li
              key={f.id}
              title={f.message}
              data-testid="findings-item"
              className={f.id === openId ? 'findings-item--open' : undefined}
              ref={(el) => {
                if (el) itemRefs.current.set(f.id, el);
                else itemRefs.current.delete(f.id);
              }}
            >
              <span className="findings-number" aria-hidden="true">{i + 1}</span> {f.title} <span className="hint">{f.severity}</span>
            </li>
          ))}
        </ol>
      ))}
    </details>
  );
}
