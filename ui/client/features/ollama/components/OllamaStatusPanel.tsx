import { Badge, GlassPanel } from '@/components/ui';

type OllamaStatusPanelProps = {
  running: boolean;
  version?: string | null;
  host?: string;
};

// Presentation-only — renders whatever status the hook already resolved.
export function OllamaStatusPanel({ running, version, host }: OllamaStatusPanelProps) {
  return (
    <GlassPanel className="ollama-status">
      <h2>Ollama</h2>
      <p>
        <Badge tone={running ? 'tool' : 'error'}>{running ? 'Running' : 'Not detected'}</Badge>
        {running && version && <span className="ollama-version"> v{version}</span>}
      </p>
      {host && <p className="hint">Checked at {host}</p>}
    </GlassPanel>
  );
}
