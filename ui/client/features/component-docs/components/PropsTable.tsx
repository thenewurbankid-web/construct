import type { ComponentDescription } from '../types';

/** The props of one component as a table. Everything is rendered as text (never as HTML). */
export function PropsTable({ component }: { component: ComponentDescription }) {
  return (
    <section className="cd-comp" data-testid="cd-component" aria-label={`${component.name} props`}>
      <h3 className="cd-h3">{component.name}</h3>
      {component.description && <p className="cd-desc">{component.description}</p>}
      {component.props.length === 0 ? (
        <p className="cd-hint">This component takes no props.</p>
      ) : (
        <div className="cd-table-wrap">
          <table className="cd-table" data-testid="cd-props">
            <caption className="cd-sr">Props of {component.name}</caption>
            <thead>
              <tr>
                <th scope="col">Prop</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Default</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {component.props.map((p) => (
                <tr key={p.name} data-testid="cd-prop">
                  <th scope="row" className="cd-mono">{p.name}</th>
                  <td className="cd-mono">{p.type}</td>
                  <td>{p.required ? 'yes' : 'no'}</td>
                  <td className="cd-mono">{p.default ?? '—'}</td>
                  <td>{p.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
