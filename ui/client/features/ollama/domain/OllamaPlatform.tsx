// Pure (DOMAIN-001) — split out of Ollama.tsx to stay under the per-file
// primary-export threshold. Takes a plain string in (the browser-global
// read itself happens in the hook, not here) and returns a plain string
// out — nothing here reaches an external effect.

export type Platform = 'mac' | 'linux' | 'windows' | 'other';

/** Best-effort platform label from a raw user-agent string — used only to
 * pick which install command to show first. The official download link is
 * always shown too, so a wrong guess costs nothing but ordering. */
export function detectPlatform(userAgent: string): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'other';
}

const INSTALL_COMMANDS: Record<Platform, string | null> = {
  mac: 'brew install ollama',
  linux: 'curl -fsSL https://ollama.com/install.sh | sh',
  windows: 'winget install Ollama.Ollama',
  other: null,
};

export function installCommandFor(platform: Platform): string | null {
  return INSTALL_COMMANDS[platform];
}
