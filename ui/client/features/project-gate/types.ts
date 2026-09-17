export type ProjectGateId = string;

/** Shape returned by ui/server's GET/POST /api/settings and POST /api/init
 * (see ui/server/src/index.mjs / settings.mjs) — the single source of truth
 * for "is the currently selected project directory a real Construct
 * project". */
export type ProjectStatus = {
  projectDir: string;
  llmProvider?: string;
  availableProviders?: string[];
  resolvedProjectRoot: string | null;
  valid: boolean;
  needsInit: boolean;
};
