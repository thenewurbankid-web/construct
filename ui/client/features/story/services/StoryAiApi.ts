// #387 -- the client calls behind the two AI-assisted story flows (design 9.6), backed by
// ui/server/src/storyAiApi.mjs. `skeleton` never calls a model; `proposePattern`/`extractValues` each spend
// exactly one. Every refusal (model offline, bad/hallucinated selector, nothing verified) comes back as a typed
// `{ ok:false, code, ... }`, the same convention as StoryApi.fetch, so the panel renders off `code` directly.
import { sendJson } from '@/lib/http';
import type { StorySelector } from './StoryApi';

export type StorySkeletonResult =
  | { ok: true; text: string; truncated: boolean; bytes: number }
  | { ok: false; code: string; error: string };

export type StoryPatternProposeResult =
  | { ok: true; feature: string; url: string; parse: Record<string, StorySelector>; rejectedFields: { name: string; reason: string }[]; calls: number; sentBytes: number; truncated: boolean }
  | { ok: false; code: 'MODEL_OFFLINE'; error: string }
  | { ok: false; code: string; error: string; rejectedFields?: { name: string; reason: string }[] };

export type StoryExtractResult =
  | { ok: true; feature: string; url: string; values: Record<string, string | string[]>; rejected: { name: string; value: string | string[]; reason: string }[]; calls: number; sentBytes: number }
  | { ok: false; code: 'MODEL_OFFLINE'; error: string }
  | { ok: false; code: 'NOTHING_VERIFIED'; error: string; rejected: { name: string; value: string | string[]; reason: string }[] }
  | { ok: false; code: string; error: string };

const UNREACHABLE = 'The Cockpit server could not be reached.';

export const StoryAiApi = {
  /** Structure-only skeleton of `html` (design 9.6, login-only pages) -- no model call, shown to the user before
   * anything is sent anywhere. */
  async skeleton(html: string): Promise<StorySkeletonResult> {
    try {
      const { body } = await sendJson<StorySkeletonResult>('POST', '/api/story-ai/skeleton', { html });
      return body;
    } catch {
      return { ok: false, code: 'UNREACHABLE', error: UNREACHABLE };
    }
  },

  /** "AI proposes the parse pattern ONCE": one model call over `html` (already fetched via StoryApi.fetch) that
   * proposes selectors, each re-validated and proved to match before being returned. Feed the result's `parse`
   * to `StoryBridgeApi.preview`/`.save` to land it as a diff -- this call never writes anything itself. */
  async proposePattern(input: { feature: string; url: string; html: string }): Promise<StoryPatternProposeResult> {
    try {
      const { body } = await sendJson<StoryPatternProposeResult>('POST', '/api/story-ai/pattern/propose', input);
      return body;
    } catch {
      return { ok: false, code: 'UNREACHABLE', error: UNREACHABLE };
    }
  },

  /** "Extraction on every use": one model call over `html` that proposes field VALUES directly; every value is
   * mechanically re-verified as quoted text before being returned (unverifiable values are rejected, never
   * handed back as if real). Feed `values` to `StoryBridgeApi.valuesPreview`/`.valuesSave` to land it as a diff. */
  async extractValues(input: { feature: string; url: string; html: string; fields?: string[] }): Promise<StoryExtractResult> {
    try {
      const { body } = await sendJson<StoryExtractResult>('POST', '/api/story-ai/extract', input);
      return body;
    } catch {
      return { ok: false, code: 'UNREACHABLE', error: UNREACHABLE };
    }
  },
};
