// #384 -- the one client call `story.md` sources go through: `StoryApi.fetch(url)`, backed by
// `POST /api/story/fetch` (ui/server/src/storyFetchApi.mjs). Every refusal (bad url, host not allowed, a
// private/metadata address, too big, too slow, an unsafe selector, no consent yet, login-only -> bridge) comes
// back as a typed `{ ok:false, code, ... }` rather than a thrown error, so a future Story tab (#385) can render
// "same UI states whichever strategy served it" (design 9.3) directly from `code`.
import { sendJson } from '@/lib/http';

/** A `parse` entry: a plain string is CSS; `{css}` / `{xpath}` are explicit (design 9.6b). */
export type StorySelector = string | { css: string } | { xpath: string };

export interface StoryFetchRequest {
  url: string;
  /** field name -> selector, e.g. `{ title: 'h1', acceptance: 'ul.acceptance > li' }`. */
  parse?: Record<string, StorySelector>;
  /** The consent choice for this call, when the Cockpit already asked (`ia-story-consent`). Omit on the first try. */
  consent?: 'once' | 'always' | 'deny';
  /** Whether the story.md this url came from was authored in this repository ('local') or arrived from a clone
   * ('foreign') -- drives the extra warning on first use (design 9.6). Defaults to 'local' on the server. */
  source?: 'local' | 'foreign';
}

export type StoryFetchResult =
  | { ok: true; via: 'server'; status: number; url: string; redirects: number; text: string; selectors: Record<string, { kind: 'css' | 'xpath'; value: string }> }
  | { ok: false; code: 'NEEDS_BRIDGE'; via: 'bridge'; host: string; error: string }
  | { ok: false; code: 'CONSENT_REQUIRED'; host: string; url: string; warning: boolean; error: string }
  | { ok: false; code: 'CONSENT_DENIED'; host: string; url: string; error: string }
  | { ok: false; code: string; error: string };

export interface StoryConsentApproval {
  id: string;
  host: string;
  url: string | null;
  scope: 'url' | 'host';
  decision: 'allow' | 'deny';
  sourceOrigin: 'local' | 'foreign';
  createdAt: string;
}

const UNREACHABLE = 'The Cockpit server could not be reached.';

export const StoryApi = {
  /** One guarded fetch, strategy chosen per link (design 9.3). Never throws. */
  async fetch(request: StoryFetchRequest): Promise<StoryFetchResult> {
    try {
      const { body } = await sendJson<StoryFetchResult>('POST', '/api/story/fetch', request);
      return body;
    } catch {
      return { ok: false, code: 'UNREACHABLE', error: UNREACHABLE };
    }
  },

  /** The standing (host, url) approvals and denials, for the revoke list (design 9.6). */
  async listConsent(): Promise<{ ok: true; approvals: StoryConsentApproval[] } | { ok: false; error: string }> {
    try {
      const { status, body } = await sendJson<{ ok: boolean; approvals?: StoryConsentApproval[]; error?: string }>('GET', '/api/story/consent');
      if (status === 200 && body.ok && body.approvals) return { ok: true, approvals: body.approvals };
      return { ok: false, error: body.error ?? 'The approvals could not be read.' };
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
  },

  /** Revoke one standing approval or denial. */
  async revokeConsent(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const { status, body } = await sendJson<{ ok: boolean; error?: string }>('DELETE', `/api/story/consent/${encodeURIComponent(id)}`);
      if (status === 200 && body.ok) return { ok: true };
      return { ok: false, error: body.error ?? 'That approval could not be revoked.' };
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
  },
};
