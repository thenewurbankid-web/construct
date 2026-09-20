export type SettingsId = string;

/** One independently-configurable LLM-touching capability (#100/Epic 6.4)
 * — `importFill`/`createFill` are small, scoped per-file "execution" fills
 * that may route to a local model; `planAnalysis` is the whole-feature
 * deep-analysis call in `import --route` and must never be 'ollama' (see
 * ui/server/src/settings.mjs's hard-rejecting validation — this isn't just
 * a UI convention). */
export type LlmCapability = 'importFill' | 'createFill' | 'planAnalysis';

export type LlmProviders = Record<LlmCapability, string>;

/** Same shape ui/server's GET/POST /api/settings returns (see
 * ui/server/src/settings.mjs) — nothing here is persisted to disk;
 * restarting the backend resets it to its defaults. */
export type Settings = {
  projectDir: string | null;
  llmProviders: LlmProviders;
  availableProviders: string[];
  availableProvidersByCapability: Record<LlmCapability, string[]>;
  resolvedProjectRoot: string | null;
  valid: boolean;
  needsInit: boolean;
};

export type SaveStatus = { ok: boolean; message: string };
