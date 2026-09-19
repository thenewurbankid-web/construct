// Pure (DOMAIN-001): fuzzy filtering of commands by a typed query.
import type { Command } from '../types.ts';

const isSubsequence = (needle: string, hay: string): boolean => {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i += 1;
  return i === needle.length;
};

/** Score of one query token against one command, or null when it does not match at all. */
function tokenScore(token: string, cmd: Command): number | null {
  const title = cmd.title.toLowerCase();
  const at = title.indexOf(token);
  if (at === 0) return 100;
  if (at > 0) return /[\s\-/:_.]/.test(title[at - 1]) ? 80 : 60;
  if ((cmd.keywords ?? []).some((k) => k.toLowerCase().includes(token))) return 40;
  if (cmd.group.toLowerCase().includes(token)) return 20;
  if (token.length >= 2 && isSubsequence(token, title)) return 10;
  return null;
}

/** Score of a whole query (space-separated tokens, all must match), or null. */
export function scoreCommand(query: string, cmd: Command): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(t, cmd);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** Commands matching `query`, best first (ties keep registration order). An empty query returns everything in order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands;
  return commands
    .map((cmd, order) => ({ cmd, order, score: scoreCommand(query, cmd) }))
    .filter((r): r is { cmd: Command; order: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.cmd);
}
