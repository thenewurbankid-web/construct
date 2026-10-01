import type { LivePreviewView } from '../domain/LivePreviewView';

/** The live preview's controls: the address, Pick, the device size picker with
 * the frame's real measured size, and the way into full screen. Hidden (not
 * unmounted) while full screen, so the trigger is there to take focus back. */
export function LivePreviewToolbar(props: LivePreviewView) {
  return (
    <div className="live-preview-head" hidden={props.fullScreen}>
      <h4>Live app preview ({props.picking ? 'Pick is on — click an element to select its source' : 'Alt+Click an element to select its source'})</h4>
      <div className="live-preview-bar">
        <input
          type="url"
          aria-label="Preview URL"
          placeholder="http://localhost:5173"
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') props.onConnect(); }}
        />
        <button type="button" onClick={props.onConnect}>Load preview</button>
        {props.url && <button type="button" onClick={props.onDisconnect}>Close</button>}
        {props.url && (
          <button
            type="button"
            className={props.picking ? 'live-preview-pick live-preview-pick--on' : 'live-preview-pick'}
            aria-pressed={props.picking}
            onClick={props.onTogglePick}
            title="Pick: click an element in the app to select its source (Alt+Click always works, on or off). Escape leaves Pick."
          >
            Pick
          </button>
        )}
      </div>
      <div className="live-preview-sizes">
        <label htmlFor="live-preview-size">Size</label>
        <select id="live-preview-size" value={props.size} onChange={(e) => props.onSize(e.target.value)}>
          {props.sizes.map((s) => (
            <option key={s.id} value={s.id} title={s.title}>{s.label}</option>
          ))}
        </select>
        <span className="live-preview-measure">{props.sizeReadout}</span>
        <button
          type="button"
          ref={props.fullScreenRef}
          className="live-preview-full-btn"
          onClick={props.onFullScreen}
          aria-keyshortcuts="Control+Alt+F"
          title="Hide the Cockpit and show the app on the whole screen (Ctrl+Alt+F; Esc to leave)"
        >
          Full screen
        </button>
      </div>
    </div>
  );
}
