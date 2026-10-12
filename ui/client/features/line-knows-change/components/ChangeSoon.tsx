/** The Change tab's slot: coming soon, with what the contract already answers. */
export function ChangeSoon({ sentence }: { sentence: string | null }) {
  return (
    <div className="lk-soon" data-testid="knows-change-soon">
      <p>Change is coming soon.</p>
      {sentence ? <p>{sentence}</p> : null}
    </div>
  );
}
