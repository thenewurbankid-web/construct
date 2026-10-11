/** The empty plan's hint; nothing once the plan has a step. */
export function PlanEmpty({ empty }: { empty: boolean }) {
  if (!empty) return null;
  return <p className="lpl-hint">No steps yet. Base on, Promote or Save adds a step here, and nothing is written until you approve it.</p>;
}
