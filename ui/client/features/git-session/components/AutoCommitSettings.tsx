'use client';

import { Field, Input, Select } from '@/components/ui';
import type { AutoCommitView, CommitConfig } from '../types';

type AutoCommitSettingsProps = {
  view: AutoCommitView;
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<CommitConfig>) => void;
};

// The controls for a feature that writes to the user's git history. Every one of them exists
// because #283 treats the opt-out and the window as part of the feature rather than polish, so
// they are on the Settings screen, not behind a flag. All wording arrives already formatted from
// domain/GitSessionView.ts.
export function AutoCommitSettings({ view, busy, error, onChange }: AutoCommitSettingsProps) {
  const { config } = view;

  return (
    <section className="git-settings" aria-labelledby="git-settings-heading">
      <h2 id="git-settings-heading">Commit on save</h2>
      <p className="hint">
        The Cockpit can commit each save to a branch of its own, with an impact-counted message
        built by Construct&apos;s own summarizers — no model, no tokens, works offline. Commits stay
        local; pushing is always something you do yourself.
      </p>

      {!view.repo && (
        <p className="git-settings__warn" role="status" data-testid="auto-commit-no-repo">
          The current project directory is not a git repository, so nothing will be committed. Saves
          still work.
        </p>
      )}

      <Field
        label="Commit saves automatically"
        hint="On by default. Turn it off and the Cockpit will never touch your git history."
      >
        <label className="git-settings__check">
          <Input
            type="checkbox"
            checked={config.enabled}
            disabled={busy}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            data-testid="auto-commit-enabled"
          />
          <span>{config.enabled ? 'On' : 'Off'}</span>
        </label>
      </Field>

      <Field label="When to commit" hint={view.modeHint}>
        <Select
          value={config.mode}
          disabled={busy || !config.enabled}
          onChange={(e) => onChange({ mode: e.target.value as CommitConfig['mode'] })}
          data-testid="auto-commit-mode"
        >
          {view.modeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {config.mode === 'coalesce' && (
        <Field label="Grouping window" hint={view.windowHint}>
          <Select
            value={String(config.coalesceMs)}
            disabled={busy || !config.enabled}
            onChange={(e) => onChange({ coalesceMs: Number(e.target.value) })}
            data-testid="auto-commit-window"
          >
            {view.windowOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Commit message prefix"
        hint={
          <>
            Yours — a ticket key, your initials, or nothing at all. The rest of the first line is
            ours: <code data-testid="auto-commit-message-example">{view.messageExample}</code>{' '}
            (session id, then a serial that counts within the branch).
          </>
        }
      >
        <Input
          type="text"
          value={config.messagePrefix}
          disabled={busy}
          placeholder="CON"
          onChange={(e) => onChange({ messagePrefix: e.target.value })}
          data-testid="auto-commit-prefix"
        />
      </Field>

      <Field
        label="Session branch prefix and suffix"
        hint={
          <>
            The branch is created on your first save and named after the work:{' '}
            <code data-testid="auto-commit-branch-example">{view.branchExample}</code>. Once created
            it is never renamed.
          </>
        }
      >
        <div className="git-settings__pair">
          <Input
            type="text"
            value={config.branchPrefix}
            disabled={busy}
            placeholder="cockpit"
            aria-label="Session branch prefix"
            onChange={(e) => onChange({ branchPrefix: e.target.value })}
            data-testid="auto-commit-branch-prefix"
          />
          <Input
            type="text"
            value={config.branchSuffix}
            disabled={busy}
            placeholder="(no suffix)"
            aria-label="Session branch suffix"
            onChange={(e) => onChange({ branchSuffix: e.target.value })}
            data-testid="auto-commit-branch-suffix"
          />
        </div>
      </Field>

      {error && <p className="status-error">{error}</p>}
      <p className="hint" data-testid="auto-commit-branch">
        Currently on <code>{view.branch || '—'}</code>.
      </p>
    </section>
  );
}
