const code = (text: string, i: number) => <code key={`${i}-${text}`}>{text}</code>;

/** A collapsed Details disclosure with one technical line per entry (tool calls, rule ids, plan step ids). */
export function TechDetails({ summary, lines, testId }: { summary: string; lines: string[]; testId?: string }) {
  if (!lines.length) return null;
  return (
    <details className="la-tech" data-testid={testId}>
      <summary>{summary}</summary>
      {lines.map(code)}
    </details>
  );
}
