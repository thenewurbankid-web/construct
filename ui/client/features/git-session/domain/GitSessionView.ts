// One status object in, two finished view models out. Everything the screens render is decided
// here so the components stay pure presentation: they receive strings and lists, never a raw API
// payload and never a formatting rule.
import type { AutoCommitView, GitSessionStatus, GitSessionView } from '../types';
import { MODE_LABELS, describeMode, formatWindow } from './CommitWording.ts';
import { describeImpact, describePerFeature } from './CommitImpactText.ts';
import { canCommitNow, describeDirtyGroups, describeSaveState } from './SaveState.ts';

/** Offered grouping windows. Short enough to be a real audit trail, long enough to be quiet. */
export const WINDOW_CHOICES = [5_000, 15_000, 30_000, 60_000, 300_000];

/** The save-time surfaces: the indicator line, the last commit, and the dirty-tree question. */
export function buildGitSessionView(status: GitSessionStatus | null): GitSessionView {
  const session = status?.session || null;
  const last = session?.lastCommit || null;
  const prompt = session?.awaitingDecision || null;
  return {
    state: describeSaveState(status),
    canCommit: canCommitNow(status),
    stash: session?.stash || null,
    lastCommit: last && {
      label: last.label,
      subject: last.subject,
      branch: last.branch,
      impactText: describeImpact(last.impact),
      perFeatureText: describePerFeature(last.impact),
    },
    prompt: prompt && {
      question: prompt.question,
      count: prompt.count,
      files: prompt.files,
      groupLines: describeDirtyGroups(prompt),
    },
  };
}

/** The Settings-screen controls, with every option already labelled and every hint already written. */
export function buildAutoCommitView(status: GitSessionStatus): AutoCommitView {
  const { config } = status;
  return {
    config,
    repo: status.repo,
    branch: status.branch,
    modeOptions: config.modes.map((mode) => ({ value: mode, label: MODE_LABELS[mode] })),
    modeHint: describeMode(config.mode, config.coalesceMs),
    windowOptions: WINDOW_CHOICES.map((ms) => ({ value: String(ms), label: formatWindow(ms) })),
    windowHint: `Saves within ${formatWindow(config.coalesceMs)} of the first one become a single commit. Longer means quieter history and a coarser audit trail.`,
    // Shown so the user can see what their prefix does before they commit with it. The session id
    // and the serial are ours; only the prefix is theirs.
    messageExample: `${config.messagePrefix ? `${config.messagePrefix}-` : ''}a3f7-0007: …`,
    branchExample: `${config.branchPrefix ? `${config.branchPrefix}/` : ''}billing-invoice-a3f7${config.branchSuffix}`,
  };
}
