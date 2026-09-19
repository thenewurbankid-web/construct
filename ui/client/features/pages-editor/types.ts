export type PagesEditorId = string;

export type PropKind = 'string' | 'number' | 'boolean' | 'identifier' | 'expression' | 'spread';

// #77 follow-up to #53 — `name` is null for a spread prop (`{...rest}` has
// no attribute name); `index` is its 0-based position in the opening tag's
// attribute list, needed to identify *which* spread to edit server-side
// since name-based lookup doesn't work for it (see PropsApi.tsx).
export type PropData = { name: string | null; kind: PropKind; value: unknown; index: number };

export type PagesEditorNode = {
  id: string;
  tag: string;
  isFragment: boolean;
  isCustomComponent: boolean;
  props: PropData[];
  children: PagesEditorNode[];
};

export type PageTree = { roots: PagesEditorNode[]; contentHash: string };

export type Violation = { rule: string; severity: string; message: string };

export type SaveOutcome = { ok: boolean; error?: string; violations?: Violation[] };

export type StatusMessage = { ok: boolean; message: string; violations?: Violation[] };

/** One contiguous run of unchanged/added/removed lines from a before/after
 * diff (#81) — `added`/`removed` both falsy means unchanged context. */
export type DiffHunk = { value: string; added?: boolean; removed?: boolean };

/** One row of a rendered before/after diff (#224), pre-computed server-side. */
export type DiffRow = {
  kind: 'context' | 'added' | 'removed' | 'gap';
  oldLine?: number;
  newLine?: number;
  text: string;
  hidden?: number;
};

/** A page file last external (on-disk, non-editor) change (#224). */
export type PageChange = {
  at: number;
  beforeHash: string;
  afterHash: string;
  stats: { added: number; removed: number };
  rows: DiffRow[];
};
