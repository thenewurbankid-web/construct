import { parseTrigger } from './trigger.mjs';

/**
 * Extracts the issue number from an issues/comments API item's `issue_url`,
 * e.g. "https://api.github.com/repos/OWNER/REPO/issues/37" -> 37.
 */
export function extractIssueNumber(issueUrl) {
  const match = typeof issueUrl === 'string' && issueUrl.match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function excerpt(text, maxLen = 800) {
  if (typeof text !== 'string' || text.length === 0) return '';
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

/** Turns a claudeRunner result into the comment posted back on the issue. */
export function summarizeRun(runResult) {
  const parsed = runResult?.parsed;
  if (parsed && typeof parsed === 'object') {
    const costLine = typeof parsed.total_cost_usd === 'number' ? `\n\n_(cost: $${parsed.total_cost_usd.toFixed(4)}, ${parsed.num_turns ?? '?'} turn(s))_` : '';
    if (parsed.is_error) {
      return `The automated run reported an error: ${parsed.result || 'unknown error'}${costLine}`;
    }
    if (typeof parsed.result === 'string' && parsed.result.trim()) {
      return `${parsed.result.trim()}${costLine}`;
    }
  }
  // Fall back to raw output if we couldn't parse a JSON result.
  const tail = (runResult?.stdout || runResult?.stderr || '').trim().slice(-1500);
  return tail
    ? `The automated run finished but its output could not be parsed as JSON. Tail of output:\n\n\`\`\`\n${tail}\n\`\`\``
    : 'The automated run finished with no output.';
}

async function safePostComment(github, issueNumber, body, log) {
  try {
    await github.postIssueComment(issueNumber, body);
  } catch (err) {
    log(`[bridge] failed to post comment on issue #${issueNumber}: ${err.message}`);
  }
}

/**
 * Resolves and caches (in stateStore-backed state) the login the token
 * belongs to, so the bridge can filter out its own comments.
 */
export async function resolveBotLogin({ github, state, log }) {
  if (state.botLogin) return state.botLogin;
  const user = await github.getAuthenticatedUser();
  state.botLogin = user.login;
  log(`[bridge] authenticated to GitHub as "${user.login}"`);
  return state.botLogin;
}

/**
 * First-ever run: record the current highest comment id and current time
 * as a baseline, WITHOUT processing anything. This deliberately avoids
 * reacting to any pre-existing "/claude" text already sitting in the
 * issue history (e.g. from earlier discussion) the first time the bridge
 * is started against a repo that already has history.
 */
export async function establishBaseline({ github, stateStore, log }) {
  const state = await stateStore.load();
  const botLogin = await resolveBotLogin({ github, state, log });
  const latestCommentId = await github.getLatestCommentId();
  state.lastSeenCommentId = latestCommentId;
  state.lastPollIso = new Date().toISOString();
  state.botLogin = botLogin;
  state.initialized = true;
  await stateStore.save(state);
  log(
    `[bridge] baseline established: will react only to comments after id ${latestCommentId} ` +
      `(${state.lastPollIso})`
  );
  return state;
}

async function handleTrigger({ comment, trigger, github, sessionStore, config, runClaudeFn, buildPromptFn, log }) {
  const issueNumber = extractIssueNumber(comment.issue_url);
  if (!issueNumber) {
    log(`[bridge] could not determine issue number for comment ${comment.id}, skipping`);
    return;
  }

  log(`[bridge] trigger detected on issue #${issueNumber} (comment ${comment.id})`);

  let issue;
  try {
    issue = await github.getIssue(issueNumber);
  } catch (err) {
    log(`[bridge] failed to fetch issue #${issueNumber}: ${err.message}`);
    return;
  }

  const sessions = await sessionStore.load();
  const existingSessionId = sessions[String(issueNumber)];

  await safePostComment(
    github,
    issueNumber,
    `Working on it${existingSessionId ? ' (continuing the previous \`claude\` session for this issue)' : ' (starting a new \`claude\` session for this issue)'}. I'll post a summary here when the run finishes.`,
    log
  );

  const prompt = buildPromptFn({
    issueNumber,
    issueTitle: issue.title,
    issueBodyExcerpt: excerpt(issue.body, 800),
    instruction: trigger.instruction,
  });

  let runResult;
  try {
    runResult = await runClaudeFn({
      claudeBin: config.claudeBin,
      cwd: config.repoDir,
      prompt,
      sessionId: existingSessionId,
      timeoutMs: config.runTimeoutMs,
      maxBudgetUsd: config.maxBudgetUsd,
    });
  } catch (err) {
    log(`[bridge] claude run failed for issue #${issueNumber}: ${err.message}`);
    await safePostComment(github, issueNumber, `The automated run hit an error and did not complete: ${err.message}`, log);
    return;
  }

  const newSessionId = runResult.parsed?.session_id || existingSessionId;
  if (newSessionId) {
    sessions[String(issueNumber)] = newSessionId;
    await sessionStore.save(sessions);
  }

  await safePostComment(github, issueNumber, summarizeRun(runResult), log);
}

/**
 * Runs a single poll cycle: fetch new comments since the last cursor,
 * find any that carry the "/claude" trigger, dispatch each to Claude, and
 * advance the durable cursor.
 *
 * The cursor snapshot is taken at the START of the cycle (before the
 * network call), and comments are de-duplicated by numeric id (which is
 * monotonically increasing and never reused), not just by timestamp. That
 * combination means: (a) a comment created while a previous cycle was
 * still processing is never missed, and (b) a comment already handled is
 * never re-processed even if GitHub's `since` filter (which matches on
 * `updated_at`) returns it again, e.g. because someone edited an old
 * comment. Editing an old, already-handled comment does NOT retrigger it.
 */
export async function pollOnce({ github, sessionStore, stateStore, runClaudeFn, buildPromptFn, config, log = console.log }) {
  // Fail closed: refuse to run a single poll cycle without an explicit,
  // non-empty allowlist. This is independent of (and stricter than) the
  // bot-self-comment filter below -- it is the actual security boundary,
  // since this repo is public and anyone can otherwise comment.
  if (!Array.isArray(config?.allowedLogins) || config.allowedLogins.length === 0) {
    throw new Error('pollOnce: config.allowedLogins must be a non-empty array -- refusing to process any comment without it.');
  }

  const state = await stateStore.load();

  if (!state.initialized) {
    await establishBaseline({ github, stateStore, log });
    return;
  }

  const botLogin = await resolveBotLogin({ github, state, log });
  const cycleStartIso = new Date().toISOString();
  const sinceIso = state.lastPollIso;
  const lastSeenId = state.lastSeenCommentId || 0;

  const comments = await github.listIssueCommentsSince(sinceIso);

  let maxSeenId = lastSeenId;
  for (const comment of comments) {
    if (comment.id > maxSeenId) maxSeenId = comment.id;
  }

  for (const comment of comments) {
    if (comment.id <= lastSeenId) continue;
    if (comment.user?.login !== botLogin && parseTrigger(comment.body) && !config.allowedLogins.includes(comment.user?.login)) {
      log(`[bridge] ignoring /claude trigger from "${comment.user?.login}" on comment ${comment.id} -- not in the allowlist`);
    }
  }

  const newComments = comments
    .filter((c) => c.id > lastSeenId)
    .filter((c) => c.user?.login !== botLogin)
    .filter((c) => config.allowedLogins.includes(c.user?.login))
    .sort((a, b) => a.id - b.id);

  for (const comment of newComments) {
    const trigger = parseTrigger(comment.body);
    if (!trigger) continue;
     
    await handleTrigger({ comment, trigger, github, sessionStore, config, runClaudeFn, buildPromptFn, log });
  }

  state.lastSeenCommentId = maxSeenId;
  state.lastPollIso = cycleStartIso;
  state.botLogin = botLogin;
  await stateStore.save(state);
}
