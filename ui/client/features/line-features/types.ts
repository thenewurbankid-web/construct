// The Features screen's own view models. The Line contract's shapes come from the one shared mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { LineFeatureDetail, LineFinding, LineHttp, LineKind, LineProject, SpecStory } from '@/lib/lineContract';

export type * from '@/lib/lineContract';
export type * from '@/lib/lineChat';
export type * from '@/lib/lineModes';
import type { ChatAsk, ChatMessage, ChatOption } from '@/lib/lineChat';

/** One feature in the list: its name, "All fine" or "Needs attention", and one line about its items. */
export type FeatureCard = { name: string; ok: boolean; status: string; text: string };

/** One item of the chosen feature, as the screen shows it. `link` opens the screen that edits it (pages, components). */
export type ItemRow = {
  id: string;
  name: string;
  status: 'ok' | 'problem';
  base: { ok: boolean; text: string };
  findings: LineFinding[];
  link: { href: string; label: string } | null;
};

/** The items of one kind ("Pages", "Components", ...). */
export type ItemGroup = { kind: LineKind; title: string; rows: ItemRow[] };

/** The spec as the screen shows it: the coverage line and the stories with their points. */
export type SpecView = { file: string; coverage: string; stories: SpecStory[] };

/** The chosen feature's detail, as the screen loads it. */
export type DetailState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; detail: LineFeatureDetail; groups: ItemGroup[]; spec: SpecView | null }
  | { phase: 'error'; sentence: string };

/** Everything the Line Features screen renders and does (built by useLineFeatures). */
export type LineFeaturesView = {
  features: FeatureCard[];
  feature: string | null;
  choose: (name: string | null) => void;
  detail: DetailState;
  /** cw1: which tab of the chosen feature is open (kept in the URL as ?view=workflows). */
  tab: FeatureTab;
  chooseTab: (tab: FeatureTab) => void;
  /** The project as last read (null until read), for the chat's answers. */
  project: LineProject | null;
  /** Reads the project and the open feature again (after a plan step wrote files). */
  reload: () => void;
  /** Two modes: the open item of the feature (?item=) and the open part of that item (?part=, a page's value). */
  item: string | null;
  part: string | null;
  /** The open item's parts (a page's values a person can change without code); empty for any other item. */
  parts: string[];
  chooseItem: (name: string | null) => void;
  choosePart: (name: string | null) => void;
};

/** The chosen feature's tabs: what it owns (Overview) and its workflows. */
export type FeatureTab = 'overview' | 'workflows';

/** Everything the Line Features API offers the screen (real server or the contract's mock). */
export type LineFeaturesApi = Pick<LineHttp, 'getProject' | 'getFeature'> & Partial<Pick<LineHttp, 'getPageTree'>>;

/** cd1: the Features chat as the screen renders it (lib/ChatEntry.tsx props, built by useFeatureChat). */
export type FeatureChatView = {
  /** The chat's heading: "Ask about <feature>", or Features. */
  title: string;
  options: ChatOption[];
  messages: ChatMessage[];
  ask: ChatAsk | null;
  busy: boolean;
  onOption: (optionId: string) => void;
  onPick: (messageId: string, itemId: string) => void;
  onAnswer: (askId: string, text: string) => void;
  onCancelAsk: () => void;
};

/** What adding a plan step answers (the Plan panel's addStep, features/line-plan). */
export type AddPlanStep = (req: { tool: string; args: Record<string, unknown> }) => Promise<{ ok: boolean; sentence: string; code?: string; detail?: string }>;
