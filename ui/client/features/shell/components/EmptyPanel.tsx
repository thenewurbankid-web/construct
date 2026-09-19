/** A designed empty state (principles #9): says what is missing and what will appear. */
export function EmptyPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="sh-empty-panel">
      <p className="sh-empty-title">{title}</p>
      <p className="hint">{hint}</p>
    </div>
  );
}
