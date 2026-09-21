import type { SourceDiagnostic } from '@/features/pages-editor';
import type { DiffHunk } from '@/features/workflows';

/** One component file of the open project, as GET /api/components lists it. `feature` is null outside features/. */
export type ComponentEntry = { name: string; path: string; feature: string | null };

export type PropDoc = { name: string; type: string; required: boolean; default: string | null; description: string };

export type ComponentDescription = { name: string; description: string; props: PropDoc[] };

/** GET /api/components/describe: the props read from the file's text (documentation only). `components: []` = no docs found. */
export type DescribeResponse =
  | { ok: true; path: string; name: string; feature: string | null; components: ComponentDescription[] }
  | { ok: false; code?: string; error?: string; path?: string };

export type SourceResponse =
  | { ok: true; path: string; name: string; feature: string | null; source: string; contentHash: string; editable: boolean; diagnostics: SourceDiagnostic[] }
  | { ok: false; code?: string; error?: string };

export type PreviewResponse = { ok: true; before: string; after: string; contentHash: string; changed: boolean } | { ok: false; code?: string; error?: string };

export type SaveResponse =
  | { ok: true; path?: string; unchanged?: boolean; contentHash: string; violations?: { rule?: string; message?: string }[]; autoCommit?: { committed?: boolean } | null }
  | { ok: false; code?: string; error?: string; violations?: { rule?: string; message?: string }[] };

/** What the doc panel shows for a description. */
export type DocView =
  | { kind: 'props'; components: ComponentDescription[] }
  | { kind: 'none'; note: string }
  | { kind: 'failed'; note: string };

export type ListState = { status: 'loading' | 'error' | 'ready'; components: ComponentEntry[]; error: string };

/** The plain-file edit flow: clean -> dirty -> (preview: diff shown) -> saving -> clean again (or an error / conflict). */
export type EditPhase = 'clean' | 'dirty' | 'checking' | 'preview' | 'saving';

export type EditState = {
  /** The file as loaded: what "clean" means and what the hash guards. */
  loaded: { path: string; source: string; contentHash: string; editable: boolean } | null;
  draft: string;
  phase: EditPhase;
  hunks: DiffHunk[];
  error: string | null;
  /** Set when a save just went through (cleared by the next edit). */
  saved: boolean;
  /** The file changed on disk since it was loaded (409): the person must reload before saving. */
  conflict: boolean;
};

export type EditAction =
  | { type: 'LOAD'; loaded: { path: string; source: string; contentHash: string; editable: boolean } }
  | { type: 'EDIT'; draft: string }
  | { type: 'CHECKING' }
  | { type: 'PREVIEW'; hunks: DiffHunk[] }
  | { type: 'CANCEL_PREVIEW' }
  | { type: 'SAVING' }
  | { type: 'SAVED'; contentHash: string }
  | { type: 'FAILED'; error: string; conflict?: boolean }
  | { type: 'DISCARD' };
