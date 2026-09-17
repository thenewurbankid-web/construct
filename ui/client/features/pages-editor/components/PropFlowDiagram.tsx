'use client';

import { GlassPanel } from '@/components/ui';
import { usePropFlow } from '../hooks/usePropFlow';
import type { PagesEditorNode } from '../types';

// #55 — colorful prop-flow diagram, driven by usePropFlow (the real
// layout/edge computation lives in the domain layer's buildFlowEdges).
export function PropFlowDiagram({ roots }: { roots: PagesEditorNode[] }) {
  const { visible, toggle, positions, edges, colorMap } = usePropFlow(roots);
  const maxX = Math.max(20, ...[...positions.values()].map((p) => p.x)) + 130;
  const maxY = Math.max(20, ...[...positions.values()].map((p) => p.y)) + 60;

  return (
    <GlassPanel className="propflow-panel">
      <h3>Prop-flow diagram (#55)</h3>
      <button type="button" onClick={toggle}>{visible ? 'Hide diagram' : 'Show diagram'}</button>
      {visible && (
        <>
          <div className="propflow-legend">
            {[...colorMap.entries()].map(([name, color]) => (
              <span key={name} className="propflow-legend-item">
                <span className="propflow-swatch" style={{ background: color }} />
                {name}
              </span>
            ))}
            {colorMap.size === 0 && <span className="hint">No props flow between nodes in this tree.</span>}
          </div>
          <svg width={maxX} height={maxY} className="propflow-svg">
            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.from.x + 60}
                y1={e.from.y + 20 + e.offset * 3}
                x2={e.to.x + 60}
                y2={e.to.y + 20 + e.offset * 3}
                stroke={e.color}
                strokeWidth={2}
                opacity={0.85}
              />
            ))}
            {[...positions.values()].map((p) => (
              <g key={p.node.id} transform={`translate(${p.x},${p.y})`}>
                <rect width={120} height={32} rx={6} className={`propflow-box${p.node.isCustomComponent ? ' component' : ''}`} />
                <text x={60} y={20} textAnchor="middle" className="propflow-box-label">
                  {p.node.isFragment ? '<>' : p.node.tag}
                </text>
              </g>
            ))}
          </svg>
        </>
      )}
    </GlassPanel>
  );
}
