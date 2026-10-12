import { Details } from '@/lib/ChatEntry';
import type { GraphLayer, ItemRef, LayerFilter, MapPicture, NeighbourSentence, StartItem } from '@/lib/lineKnowsContract';

const GROUP_LABEL: Record<StartItem['group'], string> = { feature: 'Features', page: 'Pages', component: 'Components', workflow: 'Workflows', library: 'Library' };

/** Something the person knows, grouped (features, pages, components, workflows, library); one click opens it. */
export function StartList({ items, current, onPick }: { items: StartItem[]; current: string | null; onPick: (id: string) => void }) {
  const groups = (Object.keys(GROUP_LABEL) as StartItem['group'][]).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  return (
    <nav className="lkm-start" aria-label="Start from">
      {groups.map(({ g, items: list }) => (
        <div key={g} className="lkm-start-group">
          <h3>{GROUP_LABEL[g]}</h3>
          <ul>
            {list.map((i) => (
              <li key={i.id}>
                <button type="button" className="ln-pick lkm-start-item" data-testid="knows-start" data-item={i.id} aria-current={i.id === current ? 'true' : undefined} onClick={() => onPick(i.id)}>
                  <span className="ln-pick-name">{i.name}</span>
                  <span className="ln-pick-text">{i.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The layer filter: one checkbox per layer, with how many links it has. */
export function LayerFilterBar({ filters, onToggle }: { filters: LayerFilter[]; onToggle: (l: GraphLayer) => void }) {
  return (
    <fieldset className="lkm-layers">
      <legend>Show links of</legend>
      {filters.map((f) => (
        <label key={f.layer} className="lkm-layer">
          <input type="checkbox" checked={f.on} onChange={() => onToggle(f.layer)} data-testid={`knows-layer-${f.layer}`} />
          <span>{f.label}</span>
          <span className="ln-muted"> ({f.count})</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The neighbours as sentences; the other item of each opens it; a rule break is marked. */
export function SentenceList({ sentences, onPick }: { sentences: NeighbourSentence[]; onPick: (id: string) => void }) {
  if (!sentences.length) return <p className="ln-muted">Nothing on the layers that are on.</p>;
  return (
    <ul className="lkm-sentences" aria-label="What Line knows about it">
      {sentences.map((s) => (
        <li key={s.id} className="lkm-sentence" data-bad={s.bad} data-testid="knows-sentence">
          <span>{s.text}</span>
          {s.other.startsWith('item:') || s.other.startsWith('feature:') ? (
            <button type="button" className="ln-btn ln-btn--sm ln-btn--ghost" onClick={() => onPick(s.other)} aria-label={`Open ${s.other.replace(/^[a-z]+:/, '')}`}>
              Open
            </button>
          ) : null}
          <Details lines={s.details} />
        </li>
      ))}
    </ul>
  );
}

/** "Who uses this?" or "What breaks if I change it?": the items, each one click from opening. */
export function RefList({ title, sentence, refs, onPick, testId }: { title: string; sentence: string; refs: ItemRef[]; onPick: (id: string) => void; testId: string }) {
  return (
    <section className="lkm-refs" data-testid={testId} aria-label={title}>
      <h3>{title}</h3>
      <p>{sentence}</p>
      <ul>
        {refs.map((r) => (
          <li key={r.id} data-testid={`${testId}-item`}>
            {r.id.startsWith('item:') ? (
              <button type="button" className="ln-btn ln-btn--sm ln-btn--ghost" onClick={() => onPick(r.id)}>
                {r.name}
              </button>
            ) : (
              <strong>{r.name}</strong>
            )}{' '}
            <span className="ln-muted">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** The picture (dagre's layout): boxes for items, arrows from the user to the used; a rule break is drawn in red. */
export function MapSvg({ picture, onPick, label }: { picture: MapPicture; onPick: (id: string) => void; label: string }) {
  if (!picture.nodes.length) return null;
  return (
    <div className="lkm-pic" data-testid="knows-picture" tabIndex={0} role="group" aria-label="The picture; scroll it with the arrow keys">
      <svg viewBox={`0 0 ${picture.width} ${picture.height}`} width={picture.width} height={picture.height} role="img" aria-label={label}>
        <defs>
          <marker id="lkm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {picture.edges.map((e) => (
          <path key={`${e.from}>${e.to}`} d={path(e.points)} className="lkm-edge" data-bad={e.bad} data-layer={e.layer} markerEnd="url(#lkm-arrow)" />
        ))}
        {picture.nodes.map((n) => (
          <g key={n.id} className="lkm-node" data-area={n.area} data-focus={n.focus} data-flagged={n.flagged} transform={`translate(${n.x - n.width / 2},${n.y - n.height / 2})`} onClick={() => onPick(n.id)}>
            <rect width={n.width} height={n.height} rx="6" />
            <text x={n.width / 2} y={n.height / 2 + 4} textAnchor="middle">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
