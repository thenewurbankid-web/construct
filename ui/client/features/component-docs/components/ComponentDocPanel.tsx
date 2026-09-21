import Link from 'next/link';
import { LoadingState } from '@/features/states';
import type { ComponentEntry, DocView } from '../types';
import { PropsTable } from './PropsTable';

type Props = {
  entry: ComponentEntry;
  view: DocView | null;
  /** Why no props are shown, when the reader gave a specific reason (a syntax error, a huge file). */
  reason: string | null;
};

/** The documentation half of the Components stage: name, feature, path, then the props (or the honest "none found"). */
export function ComponentDocPanel({ entry, view, reason }: Props) {
  return (
    <section className="cd-doc" data-testid="cd-doc" aria-labelledby="cd-title">
      <h2 className="cd-h2" id="cd-title" data-testid="cd-name">{entry.name}</h2>
      <dl className="cd-meta">
        <div>
          <dt>Feature</dt>
          <dd data-testid="cd-feature">
            {entry.feature ? <Link href={`/?feature=${encodeURIComponent(entry.feature)}`}>{entry.feature}</Link> : 'none (not under features/)'}
          </dd>
        </div>
        <div>
          <dt>File</dt>
          <dd className="cd-mono" data-testid="cd-path">{entry.path}</dd>
        </div>
      </dl>
      {view === null && <LoadingState size="inline" label="Reading props" />}
      {view?.kind === 'props' && view.components.map((c) => <PropsTable key={c.name} component={c} />)}
      {view?.kind === 'none' && (
        <p className="cd-none" data-testid="cd-none">
          {view.note} <span className="cd-hint">The file is below; you can still read and edit it.</span>
          {reason && <span className="cd-hint" data-testid="cd-reason"> ({reason})</span>}
        </p>
      )}
      {view?.kind === 'failed' && <p className="status-error" role="alert" data-testid="cd-failed">{view.note}</p>}
    </section>
  );
}
