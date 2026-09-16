// The one deliberate exception to "Construct makes no LLM calls" — and even
// here, scoped as tight as possible: this module does nothing but run a
// single prompt through a chosen provider's CLI and return its raw text.
// It has no opinion about what to ask; import.mjs decides that, and only
// calls this at all when the caller explicitly opts in (`--llm <provider>`).
// Everything else — locating files, scaffolding layers, wiring
// breadcrumbs — stays fully deterministic regardless of this module.
import { spawnSync } from 'node:child_process';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

// Exported (not a private const) so tests can monkey-patch a provider with a
// fake implementation instead of actually shelling out to a real CLI.
export const PROVIDERS = {
  // `-p`/`--print` (headless, one-shot), text in via stdin (so there's no
  // shell-quoting/argv-length limit on a large prompt), text out via stdout.
  // `--permission-prompts none` denies any tool-use attempt automatically
  // instead of hanging a non-interactive call — the prompt only ever asks
  // for a text completion, so nothing should try to use a tool anyway, but
  // this keeps a stuck permission prompt from being possible at all.
  claude(prompt) {
    const res = spawnSync('claude', ['-p', '--output-format', 'text', '--permission-prompts', 'none'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (res.error) {
      throw new ConstructError(
        `Could not run the "claude" CLI (${res.error.message}). Is it installed and on your PATH?`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    if (res.status !== 0) {
      throw new ConstructError(
        `"claude -p" exited with status ${res.status}: ${(res.stderr || res.stdout || '').slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    return res.stdout;
  },
};

export function callLlm(provider, prompt) {
  const impl = PROVIDERS[provider];
  if (!impl) {
    throw new ConstructError(
      `Unknown --llm provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return impl(prompt);
}

/** Best-effort cleanup for a model response that ignored "no code fences" —
 * strips one leading/trailing ```-fenced block if the whole response is
 * wrapped in exactly one, otherwise returns the response untouched. */
export function stripCodeFence(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : trimmed;
}
