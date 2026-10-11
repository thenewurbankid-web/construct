type Unknown = { word: string; choices: { ref: string; name: string }[] };

/** "Did you mean ...?" for a word the project does not know: one click answers it, and the answer becomes a synonym in
 * this project's map, so Line reads it that way from now on. */
export function DidYouMean({ unknown, meant }: { unknown: Unknown[]; meant: (word: string, ref: string) => void }) {
  const one = (u: Unknown) => {
    const choice = (c: { ref: string; name: string }) => (
      <button key={c.ref} type="button" className="ltr-btn" onClick={() => meant(u.word, c.ref)}>
        {c.name}
      </button>
    );
    return (
      <p key={u.word} className="ltr-actions" data-testid="train-did-you-mean">
        Line does not know &quot;{u.word}&quot;. Did you mean {u.choices.map(choice)}?
      </p>
    );
  };
  return <div>{unknown.map(one)}</div>;
}
