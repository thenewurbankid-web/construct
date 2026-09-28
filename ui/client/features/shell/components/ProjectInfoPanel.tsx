import type { ProjectInfoPanelProps } from '../types';

const MODEL_LABEL = { checking: 'Checking...', ready: 'Ready', offline: 'Offline' } as const;

const EXECUTION_MODE_LABEL: Record<string, string> = {
  engine: 'Engine (in-process)',
  cli: 'CLI (subprocess)',
};

/** Default "Project" tab of the Tools panel: where you are working, in plain
 * language, plus the keyboard shortcuts. Features add their own tabs beside it. */
export function ProjectInfoPanel({ dir, screenLabel, modelStatus, shortcuts, executionMode }: ProjectInfoPanelProps) {
  return (
    <div className="sh-info">
      <dl>
        <dt>Project folder</dt>
        <dd data-testid="info-project-dir">
          <code>{dir ?? 'None selected'}</code>
        </dd>
        {screenLabel && (
          <>
            <dt>Screen</dt>
            <dd>{screenLabel}</dd>
          </>
        )}
        {executionMode && (
          <>
            {/* #541: which implementation ran the last core activity (validate, create, refactor,
                import, summarize, research, review) -- `project.execution.mode` in architecture.yml. */}
            <dt>Execution mode</dt>
            <dd data-testid="info-execution-mode">{EXECUTION_MODE_LABEL[executionMode] ?? executionMode}</dd>
          </>
        )}
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
