import type { GenerateState, TestsListing } from '../types';

type TestsBannersProps = {
  data: TestsListing | null;
  generate: GenerateState;
  notice: string | null;
  onDismissNotice: () => void;
};

/** What the screen says besides the table: a clone's confirmation, the generator's refusal (its own words, with
 * the YAML to add), a generate result, and a lock that is not declared yet. Presentation-only. */
export function TestsBanners({ data, generate, notice, onDismissNotice }: TestsBannersProps) {
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
      {data?.coverageError && (
        <div className="ts-banner ts-banner--error" role="alert">
          <p>{data.coverageError}</p>
        </div>
      )}
    </>
  );
}
