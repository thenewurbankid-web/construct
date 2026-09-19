import type { Ref } from 'react';
import { GlassPanel } from '@/components/ui';

type LivePreviewPanelProps = {
  draft: string;
  onDraftChange: (v: string) => void;
  url: string | null;
  message: string | null;
  frameRef: Ref<HTMLIFrameElement>;
  onConnect: () => void;
  onDisconnect: () => void;
};

// Live preview of the target app in an iframe. Click an element (the target
// must run the Construct preview plugin, which annotates elements with their
// source position) to select the matching node in the tree/inspector.
export function LivePreviewPanel({ draft, onDraftChange, url, message, frameRef, onConnect, onDisconnect }: LivePreviewPanelProps) {
  return (
    <GlassPanel className="live-preview-panel">
      <h4>Live app preview (click an element to select its source)</h4>
      <div className="live-preview-bar">
        <input
          type="url"
          aria-label="Preview URL"
          placeholder="http://localhost:5173"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConnect(); }}
        />
        <button type="button" onClick={onConnect}>Load preview</button>
        {url && <button type="button" onClick={onDisconnect}>Close</button>}
      </div>
      {message && <p className="hint live-preview-message" role="status">{message}</p>}
      {url ? (
        <iframe ref={frameRef} className="live-preview-frame" title="Live app preview" src={url} />
      ) : (
        <p className="hint">
          Point this at your app&apos;s dev server. Add <code>constructPreview()</code> (from
          src/engine/previewVitePlugin.mjs) to its Vite config so clicks can be traced back to source.
        </p>
      )}
    </GlassPanel>
  );
}
