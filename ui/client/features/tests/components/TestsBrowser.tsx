import { useRef, type KeyboardEvent } from 'react';
import { Select } from '@/components/ui';
import type { TestsListing, TestSelection } from '../types';

type TestsBrowserProps = {
  features: string[] | null;
  feature: string;
  onFeature: (feature: string) => void;
  data: TestsListing | null;
  selected: TestSelection | null;
  onSelect: (selection: TestSelection) => void;
};

/** Browser pane, Tests tab: the feature's tests in two groups, Generated (Locked) and Yours. Up/Down move between rows. */
export function TestsBrowser({ features, feature, onFeature, data, selected, onSelect }: TestsBrowserProps) {
  const tree = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const isSel = (area: string, name: string) => selected?.area === area && selected.name === name;
  const scenarioTitle = (file: string) => data?.coverage.find((c) => c.file === file)?.title ?? file.replace(/\.spec\.ts$/, '');

  return (
    <div className="ts-tree" data-testid="tests-browser" ref={tree} onKeyDown={move}>
      <label className="ts-field">
        <span>Feature</span>
        <Select value={feature} onChange={(e) => onFeature(e.target.value)} data-testid="tests-feature">
          <option value="">Select a feature</option>
          {(features ?? []).map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </label>
      {features && features.length === 0 && <p className="hint">No feature in this project has a workflow yet, so there are no scenarios to test.</p>}
      {data && (
        <>
          <h4 className="ts-tree-h">{data.feature} · tests</h4>
          <div className="ts-group"><span>Generated</span><span className="ts-chip ts-chip--locked">Locked</span><span className="ts-group-count">{data.generated.length}</span></div>
          {data.generated.length === 0 ? (
            <p className="hint">None yet. Use Generate on the right.</p>
          ) : (
            <ul className="ts-leaves" aria-label="Generated tests, locked">
              {data.generated.map((g) => (
                <li key={g.name}>
                  <button type="button" data-tree-row data-testid="tree-generated" className="ts-leaf" aria-current={isSel('generated', g.name) ? 'true' : undefined} onClick={() => onSelect({ area: 'generated', name: g.name })} title={g.path}>
                    <span className="ts-leaf-name">{scenarioTitle(g.name)}</span>
                    <span className="ts-leaf-tag">locked</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ts-group"><span>Yours</span><span className="ts-group-count">{data.yours.length}</span></div>
          {data.yours.length === 0 ? (
            <p className="hint">Nothing yet. Clone a generated test to change it, or write your own in features/{data.feature}/tests/.</p>
          ) : (
            <ul className="ts-leaves" aria-label="Your tests">
              {data.yours.map((y) => (
                <li key={y.name}>
                  <button type="button" data-tree-row data-testid="tree-yours" className="ts-leaf" aria-current={isSel('yours', y.name) ? 'true' : undefined} onClick={() => onSelect({ area: 'yours', name: y.name })} title={y.path}>
                    <span className="ts-leaf-name">{y.name.replace(/\.spec\.ts$/, '')}</span>
                    <span className="ts-leaf-tag">{y.kind === 'clone' ? 'clone' : 'yours'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
