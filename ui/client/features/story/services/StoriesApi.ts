// #385 -- the client's read of a feature's story.md, backed by `GET /api/stories/:feature` (ui/server/src/storiesApi.mjs,
// #385 REST surface landed in 562b69f4). Mutations (add/apply/reviewed/keep) belong to the full Story tab flow and
// are not called from here yet; this is the minimal read used by the feature-row and tab-header indicator.
import { sendJson } from '@/lib/http';

export interface StoryToolBlock {
  fetchedAt: string;
  sourceHash: string;
  blockHash: string;
  handEdited: boolean;
  title: string;
  description: string;
  status: string;
  acceptance: { id: string; text: string }[];
}

export interface StoryCompare {
  missing: string[];
  undocumented: string[];
  matched: string[];
}

export type StoryView =
  | { ok: true; exists: false }
  | {
      ok: true;
      exists: true;
      keptOutOfGit: boolean;
      sources: unknown[];
      tool: StoryToolBlock | null;
      userText: string;
      compare: StoryCompare;
      driftHash: string;
      reviewedHash: string | null;
    }
  | { ok: false; error: string };

const UNREACHABLE = 'The Cockpit server could not be reached.';

export const StoriesApi = {
  /** The current view of `features/<feature>/story.md` (or `exists:false`), never throws. */
  async get(feature: string): Promise<StoryView> {
    try {
      const { body } = await sendJson<StoryView>('GET', `/api/stories/${encodeURIComponent(feature)}`);
      return body;
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
  },
};
