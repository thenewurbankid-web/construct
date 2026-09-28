/** Shapes for the Story tab (#385) and its indicator (design 9.8, `docs/design/mocks/ia-story-indicators.html`). */

/** Which strategy served the last fetch (design 9.3): the server, the user's browser (userscript bridge), or
 * (later, owner opt-in) a server-side headless browser. */
export type StoryVia = 'server' | 'your browser' | 'server browser';

/** The Story indicator, one state at a time, identical wherever it is decided (feature row poll, Story tab). */
export type StoryIndicatorState =
  | { kind: 'no-story' }
  | { kind: 'in-sync'; matched: number; total: number; via: StoryVia }
  | { kind: 'ticket-changed'; via: StoryVia }
  | { kind: 'stale-vs-code' }
  | { kind: 'checking'; via: StoryVia }
  | { kind: 'using-snapshot'; at: string; reason: 'offline-or-clipper-off' | 'ai-unavailable' }
  | { kind: 'approve-host'; host: string }
  | { kind: 're-pick' }
  | { kind: 'edited-by-hand' }
  | { kind: 'direct-content'; matched: number; total: number }
  | { kind: 'login-only-no-pattern' };

export type StoryIndicatorTone = 'ok' | 'warn' | 'busy' | 'off' | 'bad' | 'none';

export interface StoryIndicatorAction {
  id: string;
  label: string;
}

/** What a component renders: text plus a dot (never colour alone), plus a small "via" label. `text: null` is the
 * "no story yet" state, whose only trace is the "Add a story" action (design 9.8). */
export interface StoryIndicatorView {
  tone: StoryIndicatorTone;
  text: string | null;
  title?: string;
  via: StoryVia | 'written here' | null;
  actions: StoryIndicatorAction[];
}
