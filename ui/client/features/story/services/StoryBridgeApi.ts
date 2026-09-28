// #386/#387 -- the two-step "propose a diff, review, then save" client calls for story.md's `sources` list,
// backed by ui/server/src/storyBridgeApi.mjs. `preview`/`save` merge a proposed `parse` (selectors, from the
// Picker or StoryAiApi.proposePattern); `valuesPreview`/`valuesSave` merge a verified `values` result (from
// StoryAiApi.extractValues). Neither pair ever runs the selector or model call itself -- by the time either is
// called, the proposal has already been produced and (for AI) mechanically verified.
import { sendJson } from '@/lib/http';
import type { StorySelector } from './StoryApi';

export type StoryDiffResult =
  | { ok: true; before: string; after: string; changed: boolean }
  | { ok: false; error: string };

export type StorySaveResult =
  | { ok: true; changed: boolean; autoCommit?: unknown }
  | { ok: false; error: string };

const UNREACHABLE = 'The Cockpit server could not be reached.';

async function post<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const { body: out } = await sendJson<T>('POST', path, body);
    return out;
  } catch {
    return fallback;
  }
}

export const StoryBridgeApi = {
  preview(input: { feature: string; url: string; parse: Record<string, StorySelector> }): Promise<StoryDiffResult> {
    return post('/api/story-bridge/preview', input, { ok: false, error: UNREACHABLE });
  },
  save(input: { feature: string; url: string; parse: Record<string, StorySelector> }): Promise<StorySaveResult> {
    return post('/api/story-bridge/save', input, { ok: false, error: UNREACHABLE });
  },
  valuesPreview(input: { feature: string; url: string; values: Record<string, string | string[]> }): Promise<StoryDiffResult> {
    return post('/api/story-bridge/values-preview', input, { ok: false, error: UNREACHABLE });
  },
  valuesSave(input: { feature: string; url: string; values: Record<string, string | string[]> }): Promise<StorySaveResult> {
    return post('/api/story-bridge/values-save', input, { ok: false, error: UNREACHABLE });
  },
};
