/** After a fix landed: the step it fixed was checked again (owner decision c). One sentence, announced politely. */
export function PlanRecheck({ sentence }: { sentence: string | null }) {
  if (!sentence) return null;
  return (
    <p className="lpl-recheck" role="status" data-testid="plan-recheck">
      {sentence}
    </p>
  );
}
