/** The The Map tab's slot: coming soon, with what the contract already answers. */
export function MapSoon({ sentence }: { sentence: string | null }) {
  return (
    <div className="lk-soon" data-testid="knows-map-soon">
      <p>The Map is coming soon.</p>
      {sentence ? <p>{sentence}</p> : null}
    </div>
  );
}
