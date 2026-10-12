import type { StateGraph } from '../types';

type Props = { name: string; graph: StateGraph; editable: boolean; busy: boolean; onPick: (state: string) => void };

/** A behaviour's states as a graph (laid out like a workflow's state diagram): the state it is in now is filled; on a
 * feature component each other state is a button that puts it in that state (a plan step). The same as sentences sits
 * under it for a screen reader. */
export function StateGraphView({ name, graph, editable, busy, onPick }: Props) {
  return (
    <figure className="lc-graph" data-testid="lc-graph">
      <div className="lc-graph-scroll">
        <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} aria-labelledby={`lc-graph-${name}`}>
          <title id={`lc-graph-${name}`}>{`States of the ${name} behaviour`}</title>
          <defs>
            <marker id="lc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="lc-arrowhead" />
            </marker>
          </defs>
          {graph.edges.map((e) => (
            <g key={e.id} className="lc-edge">
              <path d={e.d} markerEnd="url(#lc-arrow)" />
              <text x={e.lx} y={e.ly} textAnchor="middle">
                {e.label}
              </text>
            </g>
          ))}
          {graph.nodes.map((n) => {
            const pick = editable && !busy && !n.current;
            return (
              <g
                key={n.id}
                className={n.current ? 'lc-node lc-node--current' : 'lc-node'}
                data-testid="lc-node"
                data-state={n.id}
                data-current={n.current ? 'true' : 'false'}
                {...(editable ? { role: 'button', tabIndex: 0, 'aria-pressed': n.current, 'aria-label': `Set to ${n.label}`, 'aria-disabled': !pick, 'data-line-control': 'components.setState', 'data-line-target': n.id } : {})}
                onClick={pick ? () => onPick(n.id) : undefined}
                onKeyDown={pick ? (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onPick(n.id)) : undefined}
              >
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={22} />
                <text x={n.x + n.w / 2} y={n.y + 20} textAnchor="middle" className="lc-node-label">
                  {n.label}
                </text>
                <text x={n.x + n.w / 2} y={n.y + 36} textAnchor="middle" className="lc-node-sub">
                  {n.current ? 'now' : n.initial ? 'starts here' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="lc-sr">{graph.text.join(' ')}</figcaption>
    </figure>
  );
}
