'use client';

import { Badge, GlassPanel } from '@/components/ui';
import { usePropFlow } from '../hooks/usePropFlow';
import type { PagesEditorNode } from '../types';

// #55 shipped a colorful diagram that drew one edge straight from a child's
// node-box up to its parent's node-box, per prop the child received. #75
// revises the *shape*: a parent's props now render as a row of pills (one
// per distinct prop name any of its children receive), the children render
// their own pills one level down, and real lines connect a specific parent
// pill to every same-named child pill — a real hierarchy view instead of a
// flat box-to-box edge list. The layout/edge math lives in the domain
// layer's buildPillFlow, called via usePropFlow.
export function PropFlowDiagram({ roots }: { roots: PagesEditorNode[] }) {
  const { visible, toggle, layouts, edges, colorMap } = usePropFlow(roots);
  const all = [...layouts.values()];
  const maxX = Math.max(80, ...all.map((l) => l.x + l.width / 2)) + 24;
  const maxY = Math.max(60, ...all.map((l) => l.y)) + 90;

  return (
    <GlassPanel className="propflow-panel">
      <h3>Prop-flow diagram (#75)</h3>
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
          <div className="propflow-hierarchy" style={{ width: maxX, height: maxY }}>
            <svg width={maxX} height={maxY} className="propflow-svg">
              {edges.map((e, i) => (
                <line
                  key={i}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={e.color}
                  strokeWidth={2}
                  opacity={0.85}
                  strokeDasharray={e.traced ? '4 2' : undefined}
                  className={`propflow-line${e.traced ? ' propflow-line-traced' : ''}`}
                />
              ))}
            </svg>
            {all.map((l) => (
              <div key={l.node.id} className="propflow-node-group">
                <div
                  className={`propflow-node-label${l.node.isCustomComponent ? ' component' : ''}`}
                  style={{ left: l.x, top: l.y }}
                >
                  {l.label}
                </div>
                {l.received.map((pill) => (
                  <Badge
                    key={`received-${pill.name}`}
                    className="propflow-pill propflow-pill-received"
                    style={{
                      left: pill.x,
                      top: pill.y,
                      background: `${colorMap.get(pill.name)}2a`,
                      color: colorMap.get(pill.name),
                      borderColor: colorMap.get(pill.name),
                    }}
                  >
                    {pill.name}
                  </Badge>
                ))}
                {l.outgoing.map((pill) => (
                  <Badge
                    key={`outgoing-${pill.name}`}
                    className="propflow-pill propflow-pill-outgoing"
                    style={{
                      left: pill.x,
                      top: pill.y,
                      background: `${colorMap.get(pill.name)}2a`,
                      color: colorMap.get(pill.name),
                      borderColor: colorMap.get(pill.name),
                    }}
                  >
                    {pill.name}
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </GlassPanel>
  );
}
