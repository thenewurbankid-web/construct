import { spawn } from 'node:child_process';

/**
 * Builds the prompt handed to `claude -p`. Kept as a pure function so it's
 * easy to unit test and tweak without touching process-spawning code.
 */
export function buildPrompt({ issueNumber, issueTitle, issueBodyExcerpt, instruction }) {
  return [
    'You are Claude Code, invoked automatically by the "github-comment-bridge" tool because a human posted',
    'a "/claude" trigger comment on a GitHub issue in this repository. Act on the instruction below directly',
    'in this repository: read/edit files, run commands, etc. as needed.',
    '',
    `Issue #${issueNumber}: ${issueTitle || '(no title)'}`,
    '',
    'Issue body excerpt:',
    issueBodyExcerpt || '(no body)',
    '',
    'Instruction from the triggering comment:',
    instruction,
    '',
    'When you are done, end your final reply with a concise plain-text summary (a few sentences, no markdown ' +
      'headers) of what you did and why, suitable for posting back as a GitHub issue comment. Mention concrete ' +
      'file paths, commands run, or follow-up needed if relevant.',
  ].join('\n');
}

/**
 * Invokes the real `claude` CLI non-interactively.
 *
 * Flags chosen (verified by hand against `claude --help` and by running
 * real trivial invocations before wiring this in, see README):
 *   -p                          print mode: run one turn and exit
 *   --output-format json        get a single parseable JSON result object,
 *                               including `session_id`, instead of prose
 *   --permission-mode acceptEdits
 *       lets Claude read/write files and run tools without needing an
 *       interactive approver (there isn't one — this is a headless
 *       process). Deliberately NOT `--dangerously-skip-permissions`
 *       (a full bypass); acceptEdits is the closest scoped equivalent and
 *       was verified to be sufficient for real file writes + Bash use.
 *   --resume <sessionId>        continue a specific prior `claude` session
 *                               (see sessions.json / README for how this
 *                               is tracked per issue)
 *   --max-budget-usd <n>        optional spend cap per run, since this is
 *                               triggered by a comment and should not be
 *                               able to run away unbounded by default
 *
 * @param {{
 *   claudeBin: string, cwd: string, prompt: string, sessionId?: string,
 *   timeoutMs: number, maxBudgetUsd?: string|null
 * }} opts
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string, parsed: object|null }>}
 */
export function runClaude({ claudeBin, cwd, prompt, sessionId, timeoutMs, maxBudgetUsd }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits'];
    if (sessionId) args.push('--resume', sessionId);
    if (maxBudgetUsd) args.push('--max-budget-usd', String(maxBudgetUsd));

    // spawn (no shell:true) so `prompt` is passed as a literal argv entry -
    // no quoting/injection concerns even though it contains arbitrary text.
    const child = spawn(claudeBin, args, { cwd, env: process.env });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`claude run timed out after ${timeoutMs}ms and was killed`));
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        parsed = null;
      }
      resolve({ code, stdout, stderr, parsed });
    });
  });
}
