type SettingsSummaryProps = {
  projectDir: string | null;
  resolvedProjectRoot: string | null;
};

// #391: the "Current resolution" panel repeated the form's values. What is left is the one thing the form does
// not show, the resolved project root, behind a collapsed disclosure. The model choices live only in the form.
export function SettingsSummary({ projectDir, resolvedProjectRoot }: SettingsSummaryProps) {
  return (
    <details className="glass-panel settings-current">
      <summary>Show resolved paths</summary>
      <p>
        <strong>Project directory:</strong> {projectDir ?? 'No project open'}
      </p>
      <p>
        <strong>Resolved Construct project root:</strong>{' '}
        {resolvedProjectRoot || <em>none found (no architecture.yml above this directory)</em>}
      </p>
    </details>
  );
}
