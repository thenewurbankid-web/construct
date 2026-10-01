import type { FeatureFile } from '../types';
import './feature-catalog.css';

type Props = { viewModel: FeatureFile; api: FeatureFile | null };

/** The right-panel detail card a view-model card's "API" action opens (LIN-150, owner decision 2026-09-30:
 * the panel that used to hold the API cards now holds the view models; the API moves here). Shows the
 * adapter file the view model reaches through -- the one layer still allowed to touch the real API --
 * or an empty state when the vm-chain migration for this unit hasn't added one yet. */
export function ApiDetailCard({ viewModel, api }: Props) {
  return (
    <div data-testid="fc-api-detail-card">
      <p className="fc-hint fc-violations-summary">
        API for <span className="fc-mono">{viewModel.path.split('/').pop()}</span>
      </p>
      {api ? (
        <ul className="fc-violations-list">
          <li className="fc-violation" data-testid="fc-api-file">
            <div className="fc-mono fc-hint">{api.path}</div>
            <div>{api.purpose}</div>
          </li>
        </ul>
      ) : (
        <p className="fc-hint fc-violations-summary" data-testid="fc-api-missing">
          No adapter file found for this view model yet -- it hasn&rsquo;t been built, or doesn&rsquo;t follow the deterministic naming the vm-chain expects.
        </p>
      )}
    </div>
  );
}
