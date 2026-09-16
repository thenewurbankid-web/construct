// Configuration is read entirely from environment variables. Nothing here
// ever hardcodes a token, and the token is never logged.

const DEFAULT_OWNER = 'thenewurbankid-web';
const DEFAULT_REPO = 'construct';
const DEFAULT_REPO_DIR = '/Users/shashank/Repositories/construct-final';
const DEFAULT_POLL_INTERVAL_MS = 45_000;
const DEFAULT_CLAUDE_BIN = 'claude';
const DEFAULT_RUN_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_MAX_BUDGET_USD = '3';

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   token: string, owner: string, repo: string, repoDir: string,
 *   pollIntervalMs: number, claudeBin: string, runTimeoutMs: number,
 *   maxBudgetUsd: string|null, allowedLogins: string[]
 * }}
 */
export function loadConfig(env = process.env) {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. Export a GitHub personal access token with "repo" scope ' +
        'before starting the bridge, e.g.:\n  export GITHUB_TOKEN=ghp_xxxxxxxxxxxx\n' +
        'Use a token dedicated to this long-running service, not one borrowed from something else.'
    );
  }

  const pollIntervalMs = Number(env.BRIDGE_POLL_INTERVAL_MS);
  const runTimeoutMs = Number(env.BRIDGE_RUN_TIMEOUT_MS);

  let maxBudgetUsd = env.BRIDGE_MAX_BUDGET_USD !== undefined ? env.BRIDGE_MAX_BUDGET_USD : DEFAULT_MAX_BUDGET_USD;
  if (maxBudgetUsd === '' || maxBudgetUsd === '0') maxBudgetUsd = null;

  const owner = env.GITHUB_OWNER || DEFAULT_OWNER;
  // Security-critical, fails closed: this repo is public, so anyone can
  // comment on it. Only logins in this list may ever trigger a real
  // `claude` run. Defaults to the repo owner ALONE -- not the bridge's own
  // bot login (which would be trivially satisfiable by anyone if the bot
  // account itself were ever compromised or reused) and not "everyone."
  // Override with a comma-separated BRIDGE_ALLOWED_LOGINS only to add
  // specific trusted collaborators, never to open this up broadly.
  const allowedLogins = env.BRIDGE_ALLOWED_LOGINS
    ? env.BRIDGE_ALLOWED_LOGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [owner];
  if (allowedLogins.length === 0) {
    throw new Error('BRIDGE_ALLOWED_LOGINS resolved to an empty list -- refusing to start with no one allowed to trigger it.');
  }

  return {
    token,
    owner,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    repoDir: env.BRIDGE_REPO_DIR || DEFAULT_REPO_DIR,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : DEFAULT_POLL_INTERVAL_MS,
    claudeBin: env.BRIDGE_CLAUDE_BIN || DEFAULT_CLAUDE_BIN,
    runTimeoutMs: Number.isFinite(runTimeoutMs) && runTimeoutMs > 0 ? runTimeoutMs : DEFAULT_RUN_TIMEOUT_MS,
    maxBudgetUsd,
    allowedLogins,
  };
}
