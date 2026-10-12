import type { ChangeControls } from '../types';

/** cu4: "Open in the editor" on a library card or a feature component; the open one says so. */
export function OpenInEditor({ file, name, controls }: { file: string; name: string; controls: ChangeControls }) {
  const open = controls.openEditor;
  if (!open) return null;
  const shown = controls.editing === file;
  return (
    <button type="button" className="ll-btn" aria-label={`Open in the editor: ${name}`} aria-pressed={shown} data-line-control="components.open" data-line-target={name} onClick={() => open(file)}>
      {shown ? 'In the editor' : 'Open in the editor'}
    </button>
  );
}
