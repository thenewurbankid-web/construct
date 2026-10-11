import type { LineRenderState, RenderProp, RenderResult } from '../types';

const UNREADABLE: LineRenderState = { phase: 'refused', sentence: 'Cockpit could not reach the server to render this component, so try again.' };

/** The server's answer as what the preview shows. */
export function stateFromResult(result: RenderResult | null | undefined): LineRenderState {
  if (!result || typeof result !== 'object') return UNREADABLE;
  if (result.ok === true && typeof result.html === 'string') return { phase: 'shown', html: result.html, props: result.props ?? [] };
  if (result.ok === false && typeof result.sentence === 'string') {
    if (Array.isArray(result.props)) return { phase: 'no-picture', sentence: result.sentence, detail: result.detail ?? null, props: result.props };
    return { phase: 'refused', sentence: result.sentence };
  }
  return UNREADABLE;
}

/** The props the state lists (none while loading or when refused). */
export function stateProps(state: LineRenderState): RenderProp[] {
  return state.phase === 'shown' || state.phase === 'no-picture' ? state.props : [];
}
