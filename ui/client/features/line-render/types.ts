// A typed mirror of GET /api/line/render's response (RenderResult in packages/engine/line/contract.mjs).
// The contract is the source of truth: change a shape there first, then here.

export type RenderPropKind = 'string' | 'number' | 'boolean' | 'other';

/** One prop of the rendered component: its type as written, the kind it is edited as, and the value used. */
export type RenderProp = { name: string; type: string; kind: RenderPropKind; value: unknown };

export type RenderResult =
  | { ok: true; html: string; props: RenderProp[]; via: 'morpheus' | 'construct-preview' }
  | { ok: false; code: string; sentence: string; detail?: string; props?: RenderProp[] };

/** A value the person typed or ticked, as sent to the server. */
export type PropValue = string | number | boolean;

/** What the preview shows: rendering, the picture, no picture (with a reason), or a refusal. */
export type LineRenderState =
  | { phase: 'loading' }
  | { phase: 'shown'; html: string; props: RenderProp[] }
  | { phase: 'no-picture'; sentence: string; detail: string | null; props: RenderProp[] }
  | { phase: 'refused'; sentence: string };

/** One prop's row: the prop, what its field shows, and its value as plain text. */
export type RenderPropRowView = { prop: RenderProp; input: string | boolean; text: string };

/** The preview's state and its one action: change a prop's value (the component renders again with it). */
export type LineRenderView = {
  name: string;
  state: LineRenderState;
  rows: RenderPropRowView[];
  busy: boolean;
  setProp: (prop: RenderProp, raw: string | boolean) => void;
};

/** The /components/preview route: the file from ?file=, once the address has been read, and its name. */
export type LinePreviewRoute = { file: string | null; ready: boolean; name: string };
