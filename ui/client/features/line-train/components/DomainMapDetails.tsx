type Entry = { ref: string; type: string; name: string; words: string; synonyms: string };

const row = (e: Entry) => (
  <tr key={e.ref}>
    <th scope="row">{e.name}</th>
    <td>{e.type}</td>
    <td>{e.words}</td>
    <td>{e.synonyms}</td>
  </tr>
);

/** The project's domain map, collapsed: every name Line knows, what it is, and the synonyms you confirmed. Cases are
 * saved with these names replaced by slots, never the names themselves. */
export function DomainMapDetails({ map }: { map: { label: string; entries: Entry[] } }) {
  return (
    <details className="ltr-tech ltr-section" data-testid="train-domain-map">
      <summary>{map.label}</summary>
      <div className="ltr-table-wrap">
        <table className="ltr-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">What it is</th>
              <th scope="col">Words</th>
              <th scope="col">Synonyms you confirmed</th>
            </tr>
          </thead>
          <tbody>{map.entries.map(row)}</tbody>
        </table>
      </div>
    </details>
  );
}
