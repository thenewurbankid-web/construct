'use client';

import { useShellDrawer } from '@/features/shell';
import { CHANGE_VERBS, useChange } from '../hooks/useChange';
import type { ChangeImpactPreview } from '../domain/ChangeImpact';

type ChangeTabProps = {
  feature: string;
  file: string;
  onImpactPreview: (v: ChangeImpactPreview | null) => void;
};

// #381 — Inspector "Change" tab (docs/design/ia-five-screens.md §8.3): pick a verb, fill one argument,
// see the steps with provenance and a per-file checklist, then one approval that lands in the drawer's
// Approvals tab. Move/Rename call `construct refactor move|rename` through the same Plan-mode pipeline
// (dry-run preview -> POST /api/plan/run); Extract, "Wrap in..." and Delete have no block yet and say so.
export function ChangeTab({ feature, file, onImpactPreview }: ChangeTabProps) {
  const drawer = useShellDrawer();
  const c = useChange(feature, file, onImpactPreview);

  if (!c.unit) return <p className="hint">Open a file inside a feature (features/&lt;feature&gt;/&lt;layer&gt;/…) to change it.</p>;

  const argComplete = c.verb === 'move' ? Boolean(c.toLayer) : c.newName.trim().length > 0 && c.newName !== c.unit.name;

  return (
    <div className="change-tab">
      <div className="change-verbs" role="group" aria-label="Change verb">
        {CHANGE_VERBS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="change-verb"
            aria-pressed={c.verb === v.id}
            disabled={!v.available}
            title={v.why}
            data-testid={`change-verb-${v.id}`}
            onClick={() => v.available && c.setVerb(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {(c.verb === 'extract' || c.verb === 'wrap' || c.verb === 'delete') && (
        <p className="hint" data-testid="change-no-block">
          {CHANGE_VERBS.find((v) => v.id === c.verb)?.why} This runs as a free-form AI edit, not a mechanical block — logged as a backlog signal, not offered here yet.
        </p>
      )}

      {c.verb === 'move' && (
        <p className="change-ask">
          <b>Move</b> {c.unit.name} to{' '}
          <select className="ui-select" aria-label="Target layer" data-testid="change-arg-move" value={c.toLayer} onChange={(e) => c.setToLayer(e.target.value)}>
            <option value="">Choose a layer…</option>
            {c.otherLayers.map((l) => (
              <option key={l.name} value={l.name}>{l.name}</option>
            ))}
          </select>
        </p>
      )}

      {c.verb === 'rename' && (
        <p className="change-ask">
          <b>Rename</b> {c.unit.name} to{' '}
          <input className="ui-input" aria-label="New name" data-testid="change-arg-rename" value={c.newName} onChange={(e) => c.setNewName(e.target.value)} />
        </p>
      )}

      {(c.verb === 'move' || c.verb === 'rename') && (
        <div className="change-actions">
          <button type="button" className="btn" data-testid="change-preview-btn" disabled={!argComplete || c.previewStatus === 'loading'} onClick={c.doPreview}>
            {c.previewStatus === 'loading' ? 'Checking…' : 'Preview'}
          </button>
        </div>
      )}

      {c.preview && !c.preview.ok && <p className="status-error" role="alert">{c.preview.error}</p>}

      {c.preview?.ok && (
        <>
          <div className="change-step" data-testid="change-step">
            <span className="change-step-n">1</span>
            <div className="change-step-body">
              <b>{c.label}, rewrite {c.preview.importersUpdated ?? 0} import(s)</b>
              <code className="change-step-cmd">{(c.preview.argv ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ').replace(/^/, 'construct ')}</code>
            </div>
            <span className="change-step-tag">Mechanical · 0 model calls</span>
          </div>
          {c.preview.note && <p className="hint">{c.preview.note}</p>}

          <p className="change-checklist-header" data-testid="change-checklist-header">Approve per file · {c.checkedCount} of {c.files.length}</p>
          <ul className="change-checklist">
            {c.files.map((path) => (
              <li key={path} className="change-file">
                <label>
                  <input type="checkbox" checked={c.checked[path] !== false} onChange={() => c.toggleFile(path)} data-testid={`change-file-${path}`} />
                  <span>{path}</span>
                </label>
              </li>
            ))}
          </ul>

          {c.runError && <p className="status-error" role="alert">{c.runError}</p>}

          <div className="change-approve-row">
            <button
              type="button"
              className="btn"
              data-testid="change-approve"
              disabled={c.checkedCount === 0 || c.runStatus === 'loading'}
              onClick={() => c.approve(() => drawer.openProcesses())}
            >
              {c.runStatus === 'loading' ? 'Starting…' : `Approve ${c.checkedCount} of ${c.files.length}`}
            </button>
            <button type="button" className="btn" data-testid="change-discard" onClick={c.discard}>Discard</button>
          </div>
          {c.runStatus === 'done' && (
            <p className="hint" role="status" data-testid="change-started">
              Started — review each file in the Approvals tab. Nothing was merged until you decide there.
            </p>
          )}
        </>
      )}
    </div>
  );
}
