// The preview's own view models. The shapes of GET /api/line/render (RenderResult, RenderProp) come from the one
// shared Line mirror (lib/lineContract.ts, lib/lineHttp.ts).
import type { RenderProp } from '@/lib/lineContract';

export type { RenderProp, RenderPropKind, RenderResult } from '@/lib/lineContract';

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
