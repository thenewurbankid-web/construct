import type { ProjectInfoPanelProps } from '../types';

const MODEL_LABEL = { checking: 'Checking...', ready: 'Ready', offline: 'Offline' } as const;

/** Default "Project" tab of the Tools panel: where you are working, in plain
 * language, plus the keyboard shortcuts. Features add their own tabs beside it. */
export function ProjectInfoPanel({ dir, screenLabel, modelStatus, shortcuts }: ProjectInfoPanelProps) {
  return (
    <div className="sh-info">
      <dl>
        <dt>Project folder</dt>
        <dd data-testid="info-project-dir">
          <code>{dir ?? 'None selected'}</code>
        </dd>
        <dt>Screen</dt>
        <dd>{screenLabel ?? 'None (Settings, Local model or Help)'}</dd>
        <dt>Local model</dt>
        <dd>{MODEL_LABEL[modelStatus]}</dd>
      </dl>
      <p className="sh-info-title">Keyboard shortcuts</p>
      <ul className="sh-shortcuts">
        {shortcuts.map((s) => (
          <li key={s.action}>
            <kbd>{s.keys}</kbd> {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
