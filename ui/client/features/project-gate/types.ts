export type ProjectGateId = string;

/** Shape returned by ui/server's GET/POST /api/settings and POST /api/init
 * (see ui/server/src/index.mjs / settings.mjs) — the single source of truth
 * for "is the currently selected project directory a real Construct
 * project". `llmProvider` is a legacy field mirroring `llmProviders.importFill`
 * (#100/Epic 6.4 replaced the single global provider with a per-capability
 * map) kept only so this loosely-typed status shape doesn't break; nothing
 * in project-gate actually reads either field today.
 *
 * #365: `projectDir` is null until the user opens a project (`noProject`), and every project lives inside
 * one workspace (`workspaceRoot`). `lastProject` is the previously open one, offered as "Reopen", never auto-loaded. */
export type ProjectStatus = {
  projectDir: string | null;
  noProject?: boolean;
  workspaceRoot?: string;
  lastProject?: string | null;
  llmProvider?: string;
  llmProviders?: Record<string, string>;
  availableProviders?: string[];
  resolvedProjectRoot: string | null;
  valid: boolean;
  needsInit: boolean;
};

/** Result of asking the server to open a folder as the project. */
export type OpenProjectResult = { ok: true } | { ok: false; error: string };
