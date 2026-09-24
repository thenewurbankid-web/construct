import type { IndicatorView } from '../types';

/** The save state as one polite live region: Saving..., Saved on this machine, Not saved, Changed in another tab. */
export function SaveIndicator({ indicator }: { indicator: IndicatorView }) {
  return (
    <span className={`nt-save nt-save--${indicator.tone}`} role="status" aria-live="polite" data-testid="note-save-indicator" data-tone={indicator.tone}>
      {indicator.tone === 'busy' && <span className="nt-spin" aria-hidden="true" />}
      {indicator.icon && <span aria-hidden="true">{indicator.icon}</span>} {indicator.text}
    </span>
  );
}
