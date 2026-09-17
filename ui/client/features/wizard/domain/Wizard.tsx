// Pure (DOMAIN-001). The wizard's log lines carry attribution as a plain
// "[tool: ...] [llm: ...]" string (see src/cli.mjs's printAttribution) —
// this parses that back into the same {tool, llm} shape AttributionBadge
// renders everywhere else in the app.
const ATTRIBUTION_RE = /^\[tool: (.*)\] \[llm: (.*)\]$/;

export function parseAttributionLine(text: string): { tool: string; llm: string } | null {
  const m = text.match(ATTRIBUTION_RE);
  return m ? { tool: m[1], llm: m[2] } : null;
}
