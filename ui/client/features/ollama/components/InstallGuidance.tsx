import { GlassPanel } from '@/components/ui';

type InstallGuidanceProps = {
  installCommand: string | null;
};

// Presentation-only. Deliberately never auto-runs anything — this is
// guidance text plus a copyable command, per #97's "guide install, don't
// silently auto-run a system-level installer" requirement.
export function InstallGuidance({ installCommand }: InstallGuidanceProps) {
  return (
    <GlassPanel className="ollama-install">
      <h2>Ollama isn&apos;t running</h2>
      <p>
        Construct&apos;s local-model execution (Epic 6 — Qwen Coder via Ollama) needs Ollama installed and
        running on this machine. Install it from{' '}
        <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
          ollama.com/download
        </a>
        , or run the command for your platform below, then refresh this page.
      </p>
      {installCommand && (
        <pre className="ollama-install-command">
          <code>{installCommand}</code>
        </pre>
      )}
      <p className="hint">
        Construct never runs this for you — copy/paste it yourself once you&apos;re ready.
      </p>
    </GlassPanel>
  );
}
