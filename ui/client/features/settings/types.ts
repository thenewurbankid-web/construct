export type SettingsId = string;

/** Same shape ui/server's GET/POST /api/settings returns (see
 * ui/server/src/settings.mjs) — nothing here is persisted to disk;
 * restarting the backend resets it to its defaults. */
export type Settings = {
  projectDir: string;
  llmProvider: string;
  availableProviders: string[];
  resolvedProjectRoot: string | null;
  valid: boolean;
  needsInit: boolean;
};

export type SaveStatus = { ok: boolean; message: string };
