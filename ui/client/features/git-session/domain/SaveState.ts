// What the commit indicator says, and when the Commit button is offered.
//
// The rule this encodes: a tool that writes to someone's git history must never be ambiguous about
// whether it is armed, what it is about to do, or what it just did. So every branch here produces
// a sentence about the FUTURE as well as the past — "the next save commits to a new session
// branch", "committing in 12s" — rather than only reporting after the fact.
import type { DirtyPrompt, GitSessionStatus, SaveState } from '../types';
import { MODE_LABELS, formatWindow } from './CommitWording.ts';
import { describeImpact } from './CommitImpactText.ts';

export function describeSaveState(status: GitSessionStatus | null): SaveState {
  if (!status) return { kind: 'idle', text: 'Checking git…' };
  if (!status.config.enabled) return { kind: 'off', text: 'Auto-commit is off — saves stay uncommitted.' };
  if (!status.repo) return { kind: 'no-repo', text: 'Not a git repository — saves are written but not committed.' };

  const session = status.session;
  if (session?.awaitingDecision) {
    return { kind: 'asking', text: `${session.awaitingDecision.count} file(s) were already changed when this session started.` };
  }
  if (session?.pending.length) {
    const n = session.pending.length;
    const when = status.config.mode === 'manual'
      ? 'waiting for Commit'
      : session.dueInMs !== null ? `committing in ${formatWindow(session.dueInMs)}` : 'committing…';
    return { kind: 'pending', text: `${n} unsaved-to-git change${n === 1 ? '' : 's'} — ${when}.` };
  }
  const last = session?.lastCommit;
  if (last) return { kind: 'committed', text: `${last.label} committed to ${last.branch} — ${describeImpact(last.impact)}.` };
  return { kind: 'idle', text: `Ready — the next save commits to a new session branch (${MODE_LABELS[status.config.mode].toLowerCase()}).` };
}

/** One readable line per feature for the dirty-tree prompt: `billing (domain, service) — 2 files`. */
export function describeDirtyGroups(prompt: DirtyPrompt | null | undefined): string[] {
  if (!prompt?.groups?.length) return [];
  return prompt.groups.map((g) => {
    const layers = g.layers.length ? ` (${g.layers.join(', ')})` : '';
    return `${g.name}${layers} — ${g.files.length} file${g.files.length === 1 ? '' : 's'}`;
  });
}

/** Whether Commit should be offered at all — something is pending, and no question is outstanding. */
export function canCommitNow(status: GitSessionStatus | null): boolean {
  return !!status?.config.enabled && !!status.repo && !status.session?.awaitingDecision && !!status.session?.pending.length;
}
