// The Pages screen's own view models. The Line contract's shapes come from the one shared mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { ApplyResult, CodeFragment, FeatureItem, LineFinding, LineHttp, PlanStepRequest, PropValueKind } from '@/lib/lineContract';

export type * from '@/lib/lineContract';

/** One editable prop of a part. */
export type PartProp = { name: string; kind: Exclude<PropValueKind, 'expression'>; value: string | number | boolean };

/** One part of a page: an element, the props a person can change without code, and the pieces of code on it that
 * can be edited in place (cx1; absent when it has none). */
export type PagePart = { nodeId: string; tag: string; depth: number; props: PartProp[]; fragments?: CodeFragment[] };

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

/** The outcome of a Save, as the screen shows it; `detail` is the technical reason (parser or type message) for Details. */
export type SaveOutcome = { ok: boolean; sentence: string; findings: LineFinding[]; detail?: string };

/** A refused code edit, kept next to the fragment it belongs to. */
export type FragmentOutcome = { fragmentId: string; outcome: SaveOutcome };

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
  /** cx1: save one fragment's code; a refusal stays next to that fragment's editor. */
  saveFragment: (fragment: CodeFragment, code: string) => void;
  fragmentOutcome: FragmentOutcome | null;
};

/** Everything the Line Pages API offers the screen (real server or the contract's mock). */
export type LinePagesApi = Pick<LineHttp, 'getProject' | 'getPageTree' | 'setPageProp' | 'getFragments' | 'setFragment'>;

/** cp1: what the Pages screen needs from the project's plan (the Plan panel's useLinePlan). */
export type LinePagesPlan = {
  addStep: (req: PlanStepRequest) => Promise<{ ok: boolean; sentence: string; code?: string; detail?: string }>;
  /** The step the person last ran here, with its ApplyResult when it was a change. */
  lastRun: { stepId: string; apply: ApplyResult | null; sentence: string } | null;
};
