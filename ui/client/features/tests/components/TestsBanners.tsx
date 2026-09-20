import type { GenerateState, StaleOverview, TestsListing } from '../types';
import { BrowsersMissing } from './BrowsersMissing';

type TestsBannersProps = {
  data: TestsListing | null;
  stale: StaleOverview | null;
  generate: GenerateState;
  notice: string | null;
  onDismissNotice: () => void;
  onOpenClone: (name: string) => void;
};

/** What the screen says besides the table: a clone's confirmation, the generator's refusal (its own words, with
 * the YAML to add), a generate result, and a lock that is not declared yet. Presentation-only. */
export function TestsBanners({ data, stale, generate, notice, onDismissNotice, onOpenClone }: TestsBannersProps) {
  return (
    <>
      {notice && (
        <div className="ts-banner ts-banner--ok" role="status" data-testid="tests-notice">
          <p>{notice}</p>
          <button type="button" className="ts-btn" onClick={onDismissNotice}>Dismiss</button>
        </div>
      )}
      {generate.status === 'error' && (
        <div className="ts-banner ts-banner--error" role="alert" data-testid="generate-refused">
          <h3>Tests were not generated</h3>
          <pre className="ts-pre">{generate.message}</pre>
        </div>
      )}
      {generate.status === 'done' && (
        <p className="hint" role="status" data-testid="generate-done">
          {generate.written === 0 ? 'Nothing to generate: every scenario already has its test.' : `Generated ${generate.written} test${generate.written === 1 ? '' : 's'}. They are locked.`}
        </p>
      )}
      {data && !data.lock.declared && (
        <div className="ts-banner ts-banner--warn" data-testid="lock-missing">
          <h3>Generated tests are not locked in this project yet</h3>
          <p>Construct will not generate tests until architecture.yml declares where they live.</p>
          <pre className="ts-pre">{data.lock.message}</pre>
        </div>
      )}
      {data?.environment?.browsers === 'missing' && <BrowsersMissing />}
      {stale && (
        <div className="ts-banner ts-banner--warn" data-testid="stale-overview">
          <h3>Some of your tests may be out of date</h3>
          <p>{stale.summary} Nothing was changed; you decide.</p>
          <div className="ts-actions">
            {stale.names.map((n) => <button key={n} type="button" className="ts-btn" data-testid="stale-open" onClick={() => onOpenClone(n)}>Review {n.replace(/\.spec\.ts$/, '')}</button>)}
          </div>
        </div>
      )}
      {data?.coverageError && (
        <div className="ts-banner ts-banner--error" role="alert">
          <p>{data.coverageError}</p>
        </div>
      )}
    </>
  );
}
