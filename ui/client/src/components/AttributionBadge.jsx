// Construct's design philosophy: most work is deterministic tooling, and
// LLM calls happen only where explicitly necessary — always attributed as
// tool-work vs llm-work (see src/cli.mjs's printAttribution, which every
// create/refactor/research/import command ends with). This component is
// the UI's one, consistent place that surfaces that split, instead of a
// generic "success" toast.
export function AttributionBadge({ attribution }) {
  if (!attribution) return null;
  const llmDidWork = attribution.llm && !/^0 calls\b/i.test(attribution.llm);
  return (
    <div className="attribution">
      <div className="attribution-row">
        <span className="attribution-label tool">tool</span>
        <span>{attribution.tool}</span>
      </div>
      <div className="attribution-row">
        <span className={`attribution-label ${llmDidWork ? 'llm' : 'llm-none'}`}>llm</span>
        <span>{attribution.llm}</span>
      </div>
    </div>
  );
}
