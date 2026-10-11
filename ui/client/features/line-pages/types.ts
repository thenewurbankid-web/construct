// The Pages screen's own view models. The Line contract's shapes come from the one shared mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { FeatureItem, LineFinding, LineHttp, PropValueKind } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** One editable prop of a part. */
export type PartProp = { name: string; kind: Exclude<PropValueKind, 'expression'>; value: string | number | boolean };

/** One part of a page: an element and the props a person can change without code. */
export type PagePart = { nodeId: string; tag: string; depth: number; props: PartProp[] };

/** A page row on the screen. */
export type PageRow = {
  id: string;
  name: string;
  file: string;
  status: 'ok' | 'problem';
  /** "Based on ListPage", or a plain-English problem when the base is missing or broken. */
  base: { ok: boolean; text: string };
  findings: LineFinding[];
};

/** The outcome of a Save, as the screen shows it. */
export type SaveOutcome = { ok: boolean; sentence: string; findings: LineFinding[] };

/** The chosen page's parts, as the screen loads them. */
export type PartsState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'ready'; parts: PagePart[] } | { phase: 'error'; sentence: string };

/** Everything the Line Pages screen renders and does (built by useLinePages). */
export type LinePagesView = {
  features: { name: string; summary: string }[];
  feature: string | null;
  chooseFeature: (name: string | null) => void;
  pages: PageRow[];
  page: FeatureItem | null;
  choosePage: (id: string | null) => void;
  parts: PartsState;
  save: (part: PagePart, prop: PartProp, raw: string | boolean) => void;
  saving: boolean;
  revision: number;
  outcome: SaveOutcome | null;
  /** Line cu6: the project's workspace folder ('' = whole project, null = not read); pages outside it are read-only. */
  workspaceFolder?: string | null;
};

/** Everything the Line Pages API offers the screen (real server or the contract's mock). */
export type LinePagesApi = Pick<LineHttp, 'getProject' | 'getPageTree' | 'setPageProp'>;
