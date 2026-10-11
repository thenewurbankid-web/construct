import type { PageRow } from '../types';
import { FindingItem } from './FindingItem';
import { PageReadOnlyTag } from './PageReadOnlyTag';

type PageListProps = {
  pages: PageRow[];
  current: string | null;
  onChoose: (id: string) => void;
  /** Line cu6: pages outside this folder get a quiet "Read-only" tag (null or '' tags nothing). */
  workspaceFolder?: string | null;
};

/** The pages of one feature: name, library base (or the problem with it), status, and findings. */
export function PageList({ pages, current, onChoose, workspaceFolder = null }: PageListProps) {
  if (pages.length === 0) return <p className="hint">This feature has no pages yet.</p>;
  return (
    <ul className="lp-pages" aria-label="Pages in this feature">
      {pages.map((p) => (
        <li key={p.id} className="lp-page" data-testid="lp-page" data-page={p.name} aria-current={current === p.id ? 'true' : undefined}>
          <div className="lp-page-head">
            <button type="button" className="lp-page-open" onClick={() => onChoose(p.id)} aria-pressed={current === p.id}>
              {p.name}
            </button>
            <span className={`lp-chip ${p.status === 'ok' ? 'lp-chip--ok' : 'lp-chip--problem'}`} data-testid="lp-page-status">
              {p.status === 'ok' ? 'Fine' : 'Needs attention'}
            </span>
            <PageReadOnlyTag folder={workspaceFolder} file={p.file} />
          </div>
          <p className={p.base.ok ? 'lp-base' : 'lp-base lp-base--problem'} data-testid="lp-page-base">
            {p.base.text}
          </p>
          {p.findings.length > 0 && (
            <ul className="lp-findings" aria-label={`What needs attention in ${p.name}`}>
              {p.findings.map((f, i) => (
                <FindingItem key={`${f.rule}-${f.line}-${i}`} finding={f} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
