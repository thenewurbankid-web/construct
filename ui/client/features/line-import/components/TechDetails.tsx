/** A collapsed Details disclosure with one technical line per entry (paths, rule ids, tool calls). */
export function TechDetails({ summary, lines, testId }: { summary: string; lines: string[]; testId?: string }) {
  if (!lines.length) return null;
  const codes = lines.map((l) => <code key={l}>{l}</code>);
  return (
    <details className="li-tech" data-testid={testId}>
      <summary>{summary}</summary>
      {codes}
    </details>
  );
}
