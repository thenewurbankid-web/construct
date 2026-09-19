import type { PageChange } from '../types';
import { ExternalChangeNotice } from './ExternalChangeNotice';

type DiffTabProps = { file: string; change: PageChange | null; onReload: () => void; onDismiss: () => void };

// Tools-pane "Diff" tab: what changed on disk outside the editor, with Reload / Dismiss.
export function DiffTab({ file, change, onReload, onDismiss }: DiffTabProps) {
  if (!change) return <p className="hint">No outside changes. If an agent or another editor changes this page on disk, the difference appears here.</p>;
  return <ExternalChangeNotice file={file} change={change} onReload={onReload} onDismiss={onDismiss} />;
}
