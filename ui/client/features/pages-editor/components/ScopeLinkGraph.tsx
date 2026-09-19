import type { ScopeView } from '../types';

// Presentational renderer for a ScopeView (#223): sources on the left, target props on the right,
// one coloured curve per link. The only input is the view model, so a different renderer (xyflow, a
// table) can replace this file without touching the mapper, hook or server.
const ROW = 28;
const WIDTH = 330;
const COL_W = 118;
const PAD = 8;

const rowY = (i: number) => PAD + i * ROW + ROW / 2;

export function ScopeLinkGraph({ view }: { view: ScopeView }) {
  const height = PAD * 2 + Math.max(view.sources.length, view.targets.length, 1) * ROW;
  const sourceIndex = new Map(view.sources.map((s, i) => [s.name, i]));
  const targetIndex = new Map(view.targets.map((t, i) => [t.prop, i]));
  return (
    <div className="scope-graph" style={{ width: WIDTH, height }}>
      <svg width={WIDTH} height={height} className="scope-graph-svg" aria-hidden="true">
        {view.edges.map((e) => {
          const y1 = rowY(sourceIndex.get(e.from) ?? 0);
          const y2 = rowY(targetIndex.get(e.to) ?? 0);
          const x1 = COL_W;
          const x2 = WIDTH - COL_W;
          return (
            <path
              key={`${e.from}->${e.to}`}
              className="scope-edge"
              data-from={e.from}
              data-to={e.to}
              d={`M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}
              stroke={e.color}
              strokeWidth={2}
              fill="none"
            />
          );
        })}
      </svg>
      {view.sources.map((s, i) => (
        <span
          key={s.name}
          className={`scope-source scope-kind-${s.kind}${s.linked ? ' linked' : ''}${s.unusedInPage ? ' unused' : ''}`}
          style={{ top: PAD + i * ROW, left: 0, width: COL_W, borderColor: s.color, color: s.color }}
          title={`${s.kind}${s.unusedInPage ? ' (never passed to any element)' : ''}`}
        >
          {s.name}
        </span>
      ))}
      {view.targets.map((t, i) => (
        <span
          key={t.prop}
          className={`scope-target scope-status-${t.status}`}
          style={{ top: PAD + i * ROW, left: WIDTH - COL_W, width: COL_W, ...(t.color ? { borderColor: t.color, color: t.color } : {}) }}
          title={t.text}
        >
          {t.prop}
          {t.text ? `=${t.text}` : ''}
        </span>
      ))}
    </div>
  );
}
