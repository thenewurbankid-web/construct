export type ProjectGateId = string;

/** Shape returned by ui/server's GET/POST /api/settings and POST /api/init
 * (see ui/server/src/index.mjs / settings.mjs) — the single source of truth
 * for "is the currently selected project directory a real Construct
 * project". `llmProvider` is a legacy field mirroring `llmProviders.importFill`
 * (#100/Epic 6.4 replaced the single global provider with a per-capability
 * map) kept only so this loosely-typed status shape doesn't break; nothing
 * in project-gate actually reads either field today. */
export type ProjectStatus = {
  projectDir: string;
  llmProvider?: string;
  llmProviders?: Record<string, string>;
  availableProviders?: string[];
  resolvedProjectRoot: string | null;
  valid: boolean;
  needsInit: boolean;
};
