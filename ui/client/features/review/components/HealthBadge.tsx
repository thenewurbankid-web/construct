import type { Tone } from '../types';

/** One health badge. The meaning is the TEXT; colour only reinforces it. */
export function HealthBadge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`rv-badge rv-badge--${tone}`} data-testid="review-badge" data-tone={tone}>
      {text}
    </span>
  );
}
