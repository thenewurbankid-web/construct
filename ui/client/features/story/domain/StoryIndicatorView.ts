// Pure (DOMAIN-001): the Story indicator, identical wherever it is shown (feature row, Story tab header). One
// state in, `{tone, dot, text, via, actions}` out -- text plus a dot (never colour alone), plus a small "via"
// label naming which strategy served it. Source of truth for wording: `docs/design/mocks/ia-story-indicators.html`
// (design 9.8). The state itself is decided upstream (StoryApi + freshness polling, #386/#387); this only renders it.
import type { StoryIndicatorAction, StoryIndicatorState, StoryIndicatorView } from '../types.ts';

const NO_ACTIONS: StoryIndicatorAction[] = [];

/** Every state from `docs/design/mocks/ia-story-indicators.html`, mapped 1:1 to its exact text, dot tone and via label. */
export function buildStoryIndicatorView(state: StoryIndicatorState): StoryIndicatorView {
  switch (state.kind) {
    case 'no-story':
      return { tone: 'none', text: null, via: null, actions: [{ id: 'add-story', label: 'Add a story' }] };
    case 'in-sync':
      return {
        tone: 'ok', text: `${state.matched}/${state.total} matched`, title: `Acceptance ${state.matched} of ${state.total} matched`,
        via: state.via, actions: NO_ACTIONS,
      };
    case 'ticket-changed':
      return {
        tone: 'warn', text: 'ticket changed, snapshot updated', title: 'story.md snapshot was rewritten', via: state.via,
        actions: [{ id: 'view-diff', label: 'view diff' }],
      };
    case 'stale-vs-code':
      return { tone: 'warn', text: 'may be out of date', title: 'The generated summary changed since it was reviewed', via: null, actions: [{ id: 'mark-reviewed', label: 'mark reviewed' }] };
    case 'checking':
      return { tone: 'busy', text: 'checking ticket', title: 'One check at a time', via: state.via, actions: NO_ACTIONS };
    case 'using-snapshot':
      return {
        tone: 'off', text: `using snapshot from ${state.at}`, title: state.reason === 'ai-unavailable' ? 'The configured model did not answer' : 'No userscript answered', via: null,
        actions: state.reason === 'offline-or-clipper-off' ? [{ id: 'install-clipper', label: 'Install clipper' }] : NO_ACTIONS,
      };
    case 'approve-host':
      return { tone: 'warn', text: 'approve host', title: `Allow this Cockpit to read tickets from ${state.host}`, via: null, actions: NO_ACTIONS };
    case 're-pick':
      return { tone: 'bad', text: 're-pick', title: 'The site changed its layout', via: null, actions: NO_ACTIONS };
    case 'edited-by-hand':
      return {
        tone: 'warn', text: 'snapshot edited, refresh paused', title: 'The tool-owned block differs from its fingerprint', via: null,
        actions: [{ id: 'keep-mine', label: 'keep mine' }, { id: 'use-the-ticket', label: 'use the ticket' }],
      };
    case 'direct-content':
      return {
        tone: 'ok', text: `story vs code: ${state.matched}/${state.total}`, title: 'Compared with the code only', via: 'written here',
        actions: NO_ACTIONS,
      };
    case 'login-only-no-pattern':
      return {
        tone: 'warn', text: 'pick fields', title: 'No selectors yet', via: null,
        actions: [{ id: 'pick-fields', label: 'Pick fields' }, { id: 'ai-propose-pattern', label: 'AI proposes a pattern' }],
      };
    default: {
      const exhaustive: never = state;
      throw new Error(`Unknown story indicator state: ${JSON.stringify(exhaustive)}`);
    }
  }
}
