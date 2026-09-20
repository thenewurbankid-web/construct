// Shapes for a clone's freshness (#306): the server's verdict and comparison, and what the banner draws from them.

/** Is a clone still in step with the flow it was cloned from (#306)? Only `stale` clones are flagged; nothing is rewritten for the user. */
export type FreshnessState = 'current' | 'machine-changed' | 'scenario-changed' | 'scenario-removed' | 'unknown';
export type Freshness = { state: FreshnessState; stale: boolean; summary: string; changes: number };

/** One difference between a clone's flow steps and the steps Construct would generate today. */
export type FlowChange = { kind: 'added' | 'removed' | 'changed'; at: number; text: string; before?: string; after?: string };
/** /api/tests/:feature/compare: one clone against the flow as it is now. */
export type Comparison = Freshness & { ok: true; name: string; path: string; next: string | null; comparable: boolean; changes: FlowChange[]; from: { file: string; scenario: string } | null; now: { title: string; route: string } | null };
/** What the clone banner draws (domain/FreshnessView.ts). */
export type FreshnessModel =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'note'; text: string }
  | { kind: 'stale'; title: string; from: string | null; summary: string; caveat: string | null; changes: { kind: FlowChange['kind']; word: string; text: string }[]; next: string | null };
export type StaleOverview = { names: string[]; summary: string };
export type ComparisonView = { status: 'none' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Comparison };

/** A way a generated test can fail, in words (domain/FailureKinds.ts). */
export type FailureKind = { id: 'convention' | 'app'; title: string; tone: 'warn' | 'error'; what: string; example: string; action: string };
