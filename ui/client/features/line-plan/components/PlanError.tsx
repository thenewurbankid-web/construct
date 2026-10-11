/** A refusal from the plan, as an alert; nothing when there is nothing to say. */
export function PlanError({ sentence }: { sentence: string | null }) {
  if (!sentence) return null;
  return (
    <p className="lpl-error" role="alert" data-testid="plan-error">
      {sentence}
    </p>
  );
}
