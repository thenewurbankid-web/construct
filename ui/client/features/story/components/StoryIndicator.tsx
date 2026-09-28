import type { StoryIndicatorView } from '../types.ts';

/** One quiet mark on the feature (tree row and Story tab header), identical whichever strategy served it: a dot
 * (never colour alone), the state's text, an optional "via" label, and its actions (design 9.8). */
export function StoryIndicator({ view, onAction }: { view: StoryIndicatorView; onAction?: (id: string) => void }) {
  return (
    <span className={`story-indicator story-indicator--${view.tone}`} role="status" data-testid="story-indicator" data-tone={view.tone}>
      {view.text !== null && (
        <span className="story-indicator__state" title={view.title} data-testid="story-indicator-text">
          <span className="story-indicator__dot" aria-hidden="true" />
          {view.text}
        </span>
      )}
      {view.via && (
        <span className="story-indicator__via" data-testid="story-indicator-via">
          via: {view.via}
        </span>
      )}
      {view.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="story-indicator__action"
          data-testid={`story-indicator-action-${action.id}`}
          onClick={() => onAction?.(action.id)}
        >
          {action.label}
        </button>
      ))}
    </span>
  );
}
