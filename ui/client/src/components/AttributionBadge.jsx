import { Badge } from './ui/index.js';

// Construct's design philosophy: most work is deterministic tooling, and
// LLM calls happen only where explicitly necessary — always attributed as
// tool-work vs llm-work (see src/cli.mjs's printAttribution, which every
// create/refactor/research/import command ends with). This component is
// the UI's one, consistent place that surfaces that split, instead of a
// generic "success" toast. The two labels themselves are the reusable
// Badge primitive (#46) rather than hand-rolled <span>s.
export function AttributionBadge({ attribution }) {
  if (!attribution) return null;
  const llmDidWork = attribution.llm && !/^0 calls\b/i.test(attribution.llm);
  return (
    <div className="attribution">
      <div className="attribution-row">
        <Badge tone="tool">tool</Badge>
        <span>{attribution.tool}</span>
      </div>
      <div className="attribution-row">
        <Badge tone={llmDidWork ? 'llm' : 'llm-none'}>llm</Badge>
        <span>{attribution.llm}</span>
      </div>
    </div>
  );
}
