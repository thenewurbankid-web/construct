export type ExportPanelProps = {
  /** The exported TSX; null keeps the panel closed. */
  tsx: string | null;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
};

/** The exported TSX in a dialog, with Copy and Download (.tsx). */
export function ExportPanel({ tsx, onCopy, onDownload, onClose }: ExportPanelProps) {
  if (tsx === null) return null;
  return (
    <div className="pb-scrim">
      <div className="pb-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-export-title" data-testid="pb-export-panel">
        <div className="pb-dialog-head">
          <h2 id="pb-export-title" className="pb-pane-title">
            Exported TSX
          </h2>
          <span className="pb-gap" />
          <button type="button" className="pb-btn" data-testid="pb-copy" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="pb-btn" data-testid="pb-download" onClick={onDownload}>
            Download .tsx
          </button>
          <button type="button" className="pb-btn" data-testid="pb-export-close" onClick={onClose}>
            Close
          </button>
        </div>
        <pre className="pb-code" data-testid="pb-export-code">
          {tsx}
        </pre>
      </div>
    </div>
  );
}
