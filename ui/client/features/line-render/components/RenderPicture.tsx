import { LoadingState } from '@/features/states';
import { staticHtml } from '../domain/RenderHtml';
import type { LineRenderState } from '../types';

type RenderPictureProps = { name: string; state: LineRenderState };

/** The picture: the rendered document in a sandboxed frame (no scripts, no same-origin), or one sentence why there
 * is none (the technical reason under a collapsed Details), or the refusal. */
export function RenderPicture({ name, state }: RenderPictureProps) {
  if (state.phase === 'loading') return <LoadingState size="inline" label={`Rendering ${name}`} />;
  if (state.phase === 'shown') return <iframe className="lr-frame" title={`${name} rendered alone`} sandbox="" srcDoc={staticHtml(state.html)} data-testid="lr-frame" />;
  if (state.phase === 'refused') {
    return (
      <p className="lr-note lr-note--refused" role="alert" data-testid="lr-refused">
        {state.sentence}
      </p>
    );
  }
  return (
    <div className="lr-note" data-testid="lr-no-picture">
      <p>{state.sentence}</p>
      {state.detail && (
        <details className="lr-details">
          <summary>Details</summary>
          <p>{state.detail}</p>
        </details>
      )}
    </div>
  );
}
