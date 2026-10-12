/** The Memory tab's slot: coming soon, with what the contract already answers. */
export function MemorySoon({ sentence }: { sentence: string | null }) {
  return (
    <div className="lk-soon" data-testid="knows-memory-soon">
      <p>Memory is coming soon.</p>
      {sentence ? <p>{sentence}</p> : null}
    </div>
  );
}
