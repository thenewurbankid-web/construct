import type { LivePreviewView } from '../types';

/** What stands where the app would be when there is no app to show: no address
 * configured yet, or a dev server that is not answering. Never a blank white
 * rectangle — in full screen too, where it also carries its own way back. */
export function LivePreviewEmpty(props: LivePreviewView) {
  const down = props.reach === 'down';
  return (
    <div className="live-preview-empty">
      {down ? (
        <>
          <p>
            Nothing is answering at <code>{props.url}</code>.
          </p>
          <p className="hint">Start your app&apos;s dev server (for example <code>npm run dev</code>), then try again.</p>
          <div className="live-preview-empty-actions">
            <button type="button" onClick={props.onRetry}>Try again</button>
            <button type="button" onClick={props.onLoadAnyway}>Show it anyway</button>
          </div>
        </>
      ) : (
        <p className="hint">
          Point this at your app&apos;s dev server. Add <code>constructPreview()</code> (from
          src/engine/previewVitePlugin.mjs) to its Vite config so clicks can be traced back to source.
        </p>
      )}
      {props.fullScreen && (
        <button type="button" className="live-preview-exit live-preview-exit--static" onClick={props.onExitFullScreen}>
          Leave full screen
        </button>
      )}
    </div>
  );
}
