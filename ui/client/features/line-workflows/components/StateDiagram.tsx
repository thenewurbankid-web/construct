import type { Diagram, DiagramEdge, DiagramNode } from '../types';

const nodeClass = (n: DiagramNode) => ['lw-node', n.page ? 'lw-node--page' : '', n.final ? 'lw-node--final' : ''].filter(Boolean).join(' ');

/** The arrow into the first state. */
function StartArrow({ n }: { n: DiagramNode }) {
  if (!n.initial) return null;
  return <path className="lw-start" d={`M ${n.x - 22} ${n.y + n.h / 2} L ${n.x - 4} ${n.y + n.h / 2}`} markerEnd="url(#lw-arrow)" />;
}

function nodeView(n: DiagramNode) {
  return (
    <g key={n.id} className={nodeClass(n)} data-testid="lw-node" data-state={n.id}>
      <StartArrow n={n} />
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.page ? 6 : 22} />
      <text x={n.x + n.w / 2} y={n.y + 20} textAnchor="middle" className="lw-node-label">
        {n.label}
      </text>
      <text x={n.x + n.w / 2} y={n.y + 36} textAnchor="middle" className="lw-node-sub">
        {n.sub}
      </text>
    </g>
  );
}

function edgeView(e: DiagramEdge) {
  return (
    <g key={e.id} className={e.own ? 'lw-edge lw-edge--own' : 'lw-edge'} data-testid="lw-edge" data-edge={e.id}>
      <path d={e.d} markerEnd="url(#lw-arrow)" />
      <text x={e.lx} y={e.ly} textAnchor="middle">
        {e.label}
      </text>
    </g>
  );
}

/** The workflow as a state diagram: pages as square boxes, other steps as rounded ones, the first state marked with an
 * arrow, the feature's own transitions drawn in the accent colour. The same content as sentences sits under it for a
 * screen reader. */
export function StateDiagram({ name, diagram }: { name: string; diagram: Diagram }) {
  return (
    <figure className="lw-diagram" data-testid="lw-diagram">
      <div className="lw-diagram-scroll">
        <svg viewBox={`0 0 ${diagram.width} ${diagram.height}`} width={diagram.width} height={diagram.height} role="img" aria-label={`State diagram of ${name}`}>
          <defs>
            <marker id="lw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="lw-arrowhead" />
            </marker>
          </defs>
          {diagram.edges.map(edgeView)}
          {diagram.nodes.map(nodeView)}
        </svg>
      </div>
      <figcaption className="lw-sr">{diagram.text.join(' ')}</figcaption>
    </figure>
  );
}
