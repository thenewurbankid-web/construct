#!/usr/bin/env node
// PreToolUse hook: enforces line-matcher's orchestration rule (see ../../CLAUDE.md).
//
//   The MAIN session brainstorms and answers questions. It does not write files in
//   this project. Files are written by the `builder` subagent.
//
// This hook DENIES Edit / Write / NotebookEdit (and, best-effort, file-writing Bash
// commands) inside line-matcher/ when the caller is the main session.
//
// How main is told from a subagent (Claude Code hooks reference, PreToolUse input):
//   "agent_id: present only when the hook fires inside a subagent call"
//   "agent_type: present when --agent is used or the hook fires inside a subagent"
// So a call is treated as MAIN only if the input parses, looks like a PreToolUse
// event, and has neither agent_id nor agent_type (nor a subagent transcript path).
//
// FAILS OPEN: anything unexpected (bad JSON, missing fields, exceptions) allows the call.
//
// Allowed even for the main session:
//   - any subagent
//   - CLAUDE.md, .claude/**, and the memory directory below
//   - everything, when .claude/orchestration-off exists or env LM_ORCH_OFF=1
//   - any path outside line-matcher/ (other projects are unaffected)
//
// The Bash guard is BEST-EFFORT. It parses simple shell syntax and catches the
// obvious writes. It cannot see writes done by scripts or interpreters
// (node -e, python -c, npm scripts other than the ones listed, editors, $(...) etc).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK_FILE = fileURLToPath(import.meta.url);
// <root>/.claude/hooks/orchestration.mjs -> <root>
export const PROJECT_ROOT = path.resolve(path.dirname(HOOK_FILE), '..', '..');
const MEMORY_DIR = path.join(os.homedir(), '.claude', 'projects', '-Users-shashank-Repositories-construct', 'memory');
const OVERRIDE_FILE = path.join(PROJECT_ROOT, '.claude', 'orchestration-off');

const WRITE_TOOLS = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

/** Is this absolute path inside the project and subject to the rule? */
function isGuarded(abs) {
  if (!inside(abs, PROJECT_ROOT)) return false;
  if (abs === path.join(PROJECT_ROOT, 'CLAUDE.md')) return false;
  if (inside(abs, path.join(PROJECT_ROOT, '.claude'))) return false;
  if (inside(abs, MEMORY_DIR)) return false;
  return true;
}

function resolvePath(p, cwd) {
  if (typeof p !== 'string' || p === '') return null;
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  if (/\$|`/.test(p)) return null; // unresolvable, fail open
  return path.resolve(cwd || process.cwd(), p);
}

// ---- Bash guard -------------------------------------------------------------

/** Minimal shell tokenizer: returns commands = [{ words: [...], redirects: [target...] }]. */
function parseShell(src) {
  // drop heredoc bodies so their text is not mistaken for commands or redirects
  const lines = src.split('\n');
  const kept = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    const m = line.match(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/);
    if (m) terminator = m[1] || m[2] || m[3];
  }
  src = kept.join('\n');

  const commands = [];
  let cur = { words: [], redirects: [] };
  let word = null; // null = no word in progress
  let redirectNext = false;
  const pushWord = () => {
    if (word === null) return;
    if (redirectNext) { cur.redirects.push(word); redirectNext = false; }
    else cur.words.push(word);
    word = null;
  };
  const endCommand = () => {
    pushWord();
    if (cur.words.length || cur.redirects.length) commands.push(cur);
    cur = { words: [], redirects: [] };
    redirectNext = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j === -1 ? src.length : j;
      word = (word ?? '') + src.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      word = (word ?? '') + s;
      i = j;
    } else if (c === '\\' && i + 1 < src.length) {
      word = (word ?? '') + src[i + 1];
      i++;
    } else if (c === ' ' || c === '\t') {
      pushWord();
    } else if (c === '\n' || c === ';') {
      endCommand();
    } else if (c === '&' || c === '|') {
      if (src[i + 1] === c) i++;
      // `>&` / `2>&1` are handled in the `>` branch; a bare & or | ends the command
      endCommand();
    } else if (c === '>') {
      // fd number directly before > (e.g. 2>) is not a word
      if (word !== null && /^\d+$/.test(word)) word = null;
      else pushWord();
      if (src[i + 1] === '&') { // >&2, >&-, 2>&1: no file target
        i++;
        while (i + 1 < src.length && /[0-9-]/.test(src[i + 1])) i++;
        continue;
      }
      if (src[i + 1] === '>') i++;
      if (src[i + 1] === '|') i++;
      redirectNext = true;
    } else if (c === '<') {
      pushWord();
      if (src[i + 1] === '<') { i++; if (src[i + 1] === '<') i++; }
      // input redirection: the next word is a read target, not a write. Swallow it.
      let j = i + 1;
      while (src[j] === ' ') j++;
      let k = j;
      if (src[k] === "'" || src[k] === '"') { const q = src[k]; k = src.indexOf(q, k + 1); k = k === -1 ? src.length : k + 1; }
      else while (k < src.length && !/[\s;&|<>]/.test(src[k])) k++;
      i = k - 1;
    } else {
      word = (word ?? '') + c;
    }
  }
  endCommand();
  return commands;
}

const GIT_WRITE = new Set([
  'commit', 'checkout', 'reset', 'restore', 'clean', 'merge', 'rebase', 'stash',
  'cherry-pick', 'revert', 'apply', 'am', 'switch', 'add', 'rm', 'mv',
]);
const NPM_WRITE_RUN = new Set(['generate', 'auto', 'watch', 'reset']);
const NPM_WRITE_SUB = new Set(['install', 'i', 'ci', 'update', 'uninstall', 'remove', 'add']);
const ALL_ARGS_WRITE = new Set(['rm', 'rmdir', 'mv', 'touch', 'mkdir', 'ln', 'truncate', 'unlink', 'shred', 'chmod', 'chown']);
const LAST_ARG_WRITE = new Set(['cp', 'install', 'rsync', 'scp']);
const WRAPPERS = new Set(['sudo', 'command', 'builtin', 'exec', 'time', 'nohup', 'env', 'nice', 'xargs']);

/** Returns a reason string if the command writes into the guarded project, else null. */
function bashViolation(command, startCwd, depth = 0) {
  if (depth > 3) return null;
  let cwd = startCwd || process.cwd();
  const cmds = parseShell(command);
  const guardedTarget = (p) => { const abs = resolvePath(p, cwd); return abs && isGuarded(abs) ? abs : null; };

  for (const cmd of cmds) {
    for (const target of cmd.redirects) {
      if (target === '/dev/null') continue;
      const g = guardedTarget(target);
      if (g) return `redirect writes to ${path.relative(PROJECT_ROOT, g)}`;
    }
    let words = cmd.words.slice();
    // skip leading VAR=value assignments and simple wrappers
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.has(words[0]))) words.shift();
    if (!words.length) continue;
    const name = path.basename(words[0]);
    const args = words.slice(1);
    const positional = args.filter((a) => !a.startsWith('-'));

    if (name === 'cd') { const t = resolvePath(args[0] ?? os.homedir(), cwd); if (t) cwd = t; continue; }
    if (name === 'pushd') { const t = resolvePath(args[0], cwd); if (t) cwd = t; continue; }

    if ((name === 'bash' || name === 'sh' || name === 'zsh') && args.includes('-c')) {
      const inner = args[args.indexOf('-c') + 1];
      if (typeof inner === 'string') { const r = bashViolation(inner, cwd, depth + 1); if (r) return r; }
      continue;
    }

    if (name === 'sed' && args.some((a) => a === '-i' || /^-i./.test(a) || /^-[a-zA-Z]*i[a-zA-Z]*$/.test(a) || a === '--in-place' || a.startsWith('--in-place='))) {
      if (positional.some(guardedTarget)) return 'sed -i edits a file in the project';
      continue;
    }
    if (name === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) {
      if (positional.some(guardedTarget)) return 'perl -i edits a file in the project';
      continue;
    }
    if (name === 'tee') {
      if (positional.some(guardedTarget)) return 'tee writes to a file in the project';
      continue;
    }
    if (ALL_ARGS_WRITE.has(name)) {
      if (positional.some(guardedTarget)) return `${name} changes a file in the project`;
      continue;
    }
    if (LAST_ARG_WRITE.has(name)) {
      const dest = args.includes('-t') ? args[args.indexOf('-t') + 1] : positional[positional.length - 1];
      if (positional.length >= 2 || args.includes('-t')) if (guardedTarget(dest)) return `${name} writes into the project`;
      continue;
    }
    if (name === 'find' && args.includes('-delete')) {
      const roots = positional.filter((a) => !a.startsWith('('));
      if (roots.length ? roots.some(guardedTarget) : guardedTarget('.')) return 'find -delete inside the project';
      continue;
    }
    if (name === 'git') {
      let gcwd = cwd;
      let i = 0;
      while (i < args.length && args[i].startsWith('-')) {
        if (args[i] === '-C') { const t = resolvePath(args[i + 1], gcwd); if (t) gcwd = t; i += 2; }
        else if (args[i] === '-c' || args[i] === '--git-dir' || args[i] === '--work-tree') i += 2;
        else i += 1;
      }
      const sub = args[i];
      // git commands run from the project (or a project subdirectory) are guarded;
      // the same repo also holds other projects, which stay unaffected.
      if (sub && GIT_WRITE.has(sub) && inside(gcwd, PROJECT_ROOT)) return `git ${sub} in the project`;
      continue;
    }
    if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
      if (!inside(cwd, PROJECT_ROOT)) continue;
      const sub = positional[0];
      if (NPM_WRITE_SUB.has(sub)) return `${name} ${sub} changes files in the project`;
      if (sub === 'run' && NPM_WRITE_RUN.has(positional[1])) return `${name} run ${positional[1]} writes generated files`;
      continue;
    }
  }
  return null;
}

// ---- decision ---------------------------------------------------------------

const HANDOFF = 'line-matcher rule (CLAUDE.md): the main session does not write files here. '
  + 'Hand this work to the `builder` agent with a self-contained prompt. '
  + 'To let the main session write (user said "do it yourself"): create .claude/orchestration-off or set LM_ORCH_OFF=1.';

/** Returns null to allow, or a deny reason. Never throws (fails open). */
export function decide(input, env = process.env) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (input.hook_event_name !== undefined && input.hook_event_name !== 'PreToolUse') return null;
    if (typeof input.tool_name !== 'string') return null;
    if (typeof input.session_id !== 'string') return null; // unknown layout
    // positively main: no subagent markers of any kind
    if ('agent_id' in input || 'agent_type' in input) return null;
    if (typeof input.transcript_path === 'string' && /[\\/]subagents[\\/]|[\\/]agent-[^\\/]*\.jsonl$/.test(input.transcript_path)) return null;
    if (env.LM_ORCH_OFF === '1') return null;
    if (fs.existsSync(OVERRIDE_FILE)) return null;

    const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();

    if (input.tool_name in WRITE_TOOLS) {
      const abs = resolvePath(toolInput[WRITE_TOOLS[input.tool_name]], cwd);
      if (abs && isGuarded(abs)) return `${HANDOFF} (blocked ${input.tool_name} on ${path.relative(PROJECT_ROOT, abs)})`;
      return null;
    }
    if (input.tool_name === 'Bash' && typeof toolInput.command === 'string') {
      const why = bashViolation(toolInput.command, cwd);
      if (why) return `${HANDOFF} (Bash guard, best-effort: ${why})`;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = null;
  try { input = JSON.parse(raw); } catch { input = null; }
  const reason = decide(input);
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }));
  }
  process.exit(0);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(HOOK_FILE)) {
  main().catch(() => process.exit(0));
}
