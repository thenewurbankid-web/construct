// Findings, blast radius and failure view models and their component props (#315, #316, #318).
// Re-exported from types.ts, so importers keep using '../types'.
import type { PlanChoice, Tone } from '../types.ts';

/** One finding as the Findings tab shows it: which group, and (mechanical only) the exact command. */
export type FindingRow = {
  id: string;
  indicatorTitle: string;
  title: string;
  message: string;
  location: string | null;
  severityLabel: string;
  selected: boolean;
  /** Only on mechanical findings; a conversation finding never has one. */
  fix: { command: string; available: boolean; text: string } | null;
};
export type FindingsView = {
  total: number;
  mechanical: FindingRow[];
  conversation: FindingRow[];
  /** "2 of 5 findings can be fixed mechanically" */
  summary: string;
};
export type FindingDetailView = {
  id: string;
  resolution: 'mechanical' | 'conversation';
  resolutionLabel: string;
  title: string;
  location: string | null;
  rule: string | null;
  why: string | null;
  constraint: string | null;
  message: string;
  files: string[];
  fix: FindingRow['fix'];
};

export type BlastRow = { feature: string; declared: boolean; files: number; note: string };
export type BlastView =
  | { measured: false; tone: 'neutral'; title: string; text: string; reason: string }
  | { measured: true; tone: Tone; statusLabel: string; headline: string; rows: BlastRow[]; extraFiles: string[]; extraFilesTotal: number; missingFiles: string[] };

/** What a failure says: what happened, and the next things the person can do. */
export type FailureAction = 'retry' | 'list' | 'settings' | 'no-plan';
export type FailureView = { title: string; what: string; next: string; actions: FailureAction[] };

// ---- findings, blast radius, states (#315, #316, #318) --------------------------

export type FindingsPanelProps = { view: FindingsView; onSelect: (id: string) => void };
export type FindingDetailProps = { detail: FindingDetailView; onClose: () => void };
export type FindingsSummaryProps = { summary: string; mechanical: number; conversation: number; degraded: string | null };
export type PlanPickerProps = { plans: PlanChoice[]; selected: string | null; selectedTitle: string | null; onPick: (id: string | null) => void };
export type BlastRadiusProps = { view: BlastView; picker: PlanPickerProps };
export type FailureNoticeProps = { failure: FailureView; testId: string; onAction: (a: FailureAction) => void };
