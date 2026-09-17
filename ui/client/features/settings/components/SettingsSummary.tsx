import { GlassPanel } from '@/components/ui';

type SettingsSummaryProps = {
  projectDir: string;
  resolvedProjectRoot: string | null;
  llmProvider: string;
};

// Presentation-only "current resolution" panel.
export function SettingsSummary({ projectDir, resolvedProjectRoot, llmProvider }: SettingsSummaryProps) {
  return (
    <GlassPanel className="settings-current">
      <h2>Current resolution</h2>
      <p>
        <strong>Project directory:</strong> {projectDir}
      </p>
      <p>
        <strong>Resolved Construct project root:</strong>{' '}
        {resolvedProjectRoot || (
          <em>none found (no architecture.yml above this directory) — run “create feature” or an init-equivalent first</em>
        )}
      </p>
      <p>
        <strong>LLM provider:</strong> {llmProvider || <em>none</em>}
      </p>
    </GlassPanel>
  );
}
