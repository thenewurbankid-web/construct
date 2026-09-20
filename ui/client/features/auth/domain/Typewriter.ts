// The login screen's changing tagline (owner request 2026-09-20): a typing effect that cycles through a few
// short, casual one-liners (not dramatic). Pure state stepping — no timers, no React — so the rhythm is unit-testable (Typewriter.spec.mjs).

export const LOGIN_PHRASES: readonly string[] = [
  'Sign in to try a calmer way to build.',
  'Plan it, preview it, then approve it.',
  'Same input, same result.',
  'Small blocks, no guesswork.',
  'You stay in the driver’s seat.',
];

export type TypewriterPhase = 'typing' | 'holding' | 'deleting';
export type TypewriterState = { phraseIndex: number; chars: number; phase: TypewriterPhase };

export const TYPING_MS = 55;
export const DELETING_MS = 28;
export const HOLD_MS = 1800;
export const GAP_MS = 350;

export const initialTypewriter: TypewriterState = { phraseIndex: 0, chars: 0, phase: 'typing' };

/** The text currently shown for a state. */
export function typedText(state: TypewriterState, phrases: readonly string[]): string {
  return (phrases[state.phraseIndex % phrases.length] ?? '').slice(0, state.chars);
}

/** One tick: the next state and how long to wait before the tick after it. */
export function stepTypewriter(
  state: TypewriterState,
  phrases: readonly string[],
): { state: TypewriterState; delayMs: number } {
  const phrase = phrases[state.phraseIndex % phrases.length] ?? '';
  if (state.phase === 'typing') {
    if (state.chars < phrase.length) return { state: { ...state, chars: state.chars + 1 }, delayMs: TYPING_MS };
    return { state: { ...state, phase: 'holding' }, delayMs: HOLD_MS };
  }
  if (state.phase === 'holding') return { state: { ...state, phase: 'deleting' }, delayMs: DELETING_MS };
  if (state.chars > 0) return { state: { ...state, chars: state.chars - 1 }, delayMs: DELETING_MS };
  return { state: { phraseIndex: (state.phraseIndex + 1) % phrases.length, chars: 0, phase: 'typing' }, delayMs: GAP_MS };
}
