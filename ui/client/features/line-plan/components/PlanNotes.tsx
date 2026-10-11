/** The panel's one-sentence notes: a refusal (an alert), or the empty plan's hint. Each renders nothing when there is
 * nothing to say. */
export function PlanError({ sentence }: { sentence: string | null }) {
  if (!sentence) return null;
  return (
    <p className="lpl-error" role="alert" data-testid="plan-error">
      {sentence}
    </p>
  );
}

export function PlanEmpty({ empty }: { empty: boolean }) {
  if (!empty) return null;
  return <p className="lpl-hint">No steps yet. Base on, Promote or Save adds a step here, and nothing is written until you approve it.</p>;
}
