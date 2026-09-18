export type PagesEditorId = string;

export type PropKind = 'string' | 'number' | 'boolean' | 'identifier' | 'expression' | 'spread';

export type PropData = { name: string; kind: PropKind; value: unknown };

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
