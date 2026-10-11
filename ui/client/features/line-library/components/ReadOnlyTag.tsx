/** Line cu6: the quiet tag on a card or row outside the project's workspace folder (Line will not change it). */
export function ReadOnlyTag({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="ll-chip ll-chip--quiet" data-testid="line-read-only" title="Outside your workspace folder; Line will not change it.">
      Read-only
    </span>
  );
}
