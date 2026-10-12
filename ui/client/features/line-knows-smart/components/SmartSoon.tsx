/** The How smart is it tab's slot: coming soon, with what the contract already answers. */
export function SmartSoon({ sentence }: { sentence: string | null }) {
  return (
    <div className="lk-soon" data-testid="knows-smart-soon">
      <p>How smart is it is coming soon.</p>
      {sentence ? <p>{sentence}</p> : null}
    </div>
  );
}
