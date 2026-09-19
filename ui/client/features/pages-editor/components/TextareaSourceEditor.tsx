import type { SourceEditorProps } from '../types';

// Plain <textarea> adapter for SourceEditorProps: the SSR / test / offline
// fallback, and proof the contract is editor-agnostic. Markers can't be drawn
// inside a textarea, so their lines are exposed for assistive tech and tests
// via a data attribute (the panel's diagnostics list shows them visibly).
export function TextareaSourceEditor({ value, markers, readOnly, onChange, label = 'Page source' }: SourceEditorProps) {
  return (
    <textarea
      className="source-editor-textarea"
      aria-label={label}
      data-source-editor="textarea"
      data-marker-lines={markers.map((m) => m.startLine).join(',')}
      readOnly={readOnly}
      spellCheck={false}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      rows={Math.min(24, Math.max(6, value.split('\n').length + 1))}
    />
  );
}
