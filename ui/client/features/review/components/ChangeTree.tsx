import type { ChangeTreeProps, TreeFile } from '../types';

const GROUPINGS: { id: ChangeTreeProps['grouping']; label: string }[] = [
  { id: 'feature', label: 'By feature' },
  { id: 'layer', label: 'By layer' },
  { id: 'files', label: 'Files' },
];

function FileButton({ file, selected, onSelect, showLayer }: { file: TreeFile; selected: boolean; onSelect: (p: string) => void; showLayer?: boolean }) {
  return (
    <button type="button" className="rv-file" data-testid="review-file" data-path={file.path} aria-current={selected ? 'true' : undefined} title={file.path} onClick={() => onSelect(file.path)}>
      <span className="rv-file-name">{file.name}</span>
      {showLayer && <span className="rv-chip">{file.layer ?? 'other'}</span>}
      <span className={`rv-status rv-status--${file.status}`}>{file.statusLabel}</span>
    </button>
  );
}

/** Browser pane of one change: CHANGED UNITS GROUPED BY FEATURE THEN LAYER (or by layer, or flat). */
export function ChangeTree({ grouping, onGrouping, totals, byFeature, byLayer, flat, selectedPath, onSelect }: ChangeTreeProps) {
  return (
    <div className="rv-side" data-testid="review-tree">
      <div className="rv-toggle rv-toggle--tabs" role="group" aria-label="Group changed units">
        {GROUPINGS.map((g) => (
          <button key={g.id} type="button" aria-pressed={grouping === g.id} data-testid={`review-group-${g.id}`} onClick={() => onGrouping(g.id)}>{g.label}</button>
        ))}
      </div>
      <p className="rv-hint" data-testid="review-totals">{totals}</p>
      {grouping === 'feature' && (
        <ul className="rv-tree" aria-label="Changed units by feature">
          {byFeature.map((f) => (
            <li key={f.key} data-testid="review-feature" data-feature={f.name || 'outside'}>
              <p className="rv-feature"><span className="rv-feature-name">{f.label}</span> <span className="rv-count">{f.fileCount} {f.fileCount === 1 ? 'file' : 'files'}</span></p>
              <ul className="rv-tree rv-tree--inner">
                {f.layers.map((l) => (
                  <li key={l.layer} data-testid="review-layer" data-layer={l.layer}>
                    <p className="rv-layer"><span className="rv-chip">{l.label}</span> <span className="rv-count">{l.files.length}</span></p>
                    <ul className="rv-tree rv-tree--inner">
                      {l.files.map((file) => (
                        <li key={file.path}><FileButton file={file} selected={file.path === selectedPath} onSelect={onSelect} /></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {grouping === 'layer' && (
        <ul className="rv-tree" aria-label="Changed units by layer">
          {byLayer.map((l) => (
            <li key={l.layer} data-testid="review-layer-group" data-layer={l.layer}>
              <p className="rv-feature"><span className="rv-feature-name">{l.label}</span> <span className="rv-count">{l.fileCount}</span></p>
              <ul className="rv-tree rv-tree--inner">
                {l.files.map((file) => (
                  <li key={file.path}><FileButton file={file} selected={file.path === selectedPath} onSelect={onSelect} /></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {grouping === 'files' && (
        <ul className="rv-tree" aria-label="Changed files">
          {flat.map((file) => (
            <li key={file.path}><FileButton file={file} selected={file.path === selectedPath} onSelect={onSelect} showLayer /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
