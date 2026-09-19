import type { PageChange } from '../types';
import { DiffView } from './DiffView';

type ExternalChangeNoticeProps = {
  file: string;
  change: PageChange;
  onReload: () => void;
  onDismiss: () => void;
};

// #224 — shown when a page file changed on disk outside the editor (an
// agent, the CLI, another editor): a notice plus a before/after diff.
export function ExternalChangeNotice({ file, change, onReload, onDismiss }: ExternalChangeNoticeProps) {
  return (
    <section className="external-change-notice" role="alert">
      <h4>
        {file} changed outside the editor{' '}
        <span className="hint">
          (+{change.stats.added} / &minus;{change.stats.removed} lines)
        </span>
      </h4>
      <p className="hint">Review what changed. The tree below shows the file as it was when you opened it until you reload.</p>
      <DiffView rows={change.rows} />
      <div className="snippet-diff-actions">
        <button type="button" onClick={onReload}>Reload from disk</button>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </section>
  );
}
