import { GlassPanel } from '@/components/ui';
import type { LlmProviders } from '../types';

type SettingsSummaryProps = {
  projectDir: string;
  resolvedProjectRoot: string | null;
  llmProviders: LlmProviders;
};

const CAPABILITY_LABELS: Record<keyof LlmProviders, string> = {
  importFill: 'Import fill',
  createFill: 'Create/generate fill',
  planAnalysis: 'Plan analysis',
};

// Presentation-only "current resolution" panel.
export function SettingsSummary({ projectDir, resolvedProjectRoot, llmProviders }: SettingsSummaryProps) {
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
      {(Object.keys(CAPABILITY_LABELS) as (keyof LlmProviders)[]).map((capability) => (
        <p key={capability}>
          <strong>{CAPABILITY_LABELS[capability]}:</strong> {llmProviders[capability] || <em>none</em>}
        </p>
      ))}
    </GlassPanel>
  );
}
