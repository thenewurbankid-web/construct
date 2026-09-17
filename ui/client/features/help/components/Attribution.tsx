import { Badge } from '@/components/ui';

export function Attribution() {
  return (
    <div>
      <p>
        Every command&apos;s result — on the Dashboard, and as chat bubbles in the Import Wizard — ends
        with two labeled rows instead of one generic &quot;success&quot; message:
      </p>
      <ul>
        <li>
          <Badge tone="tool">tool</Badge> what Construct&apos;s own deterministic code did — files
          created/moved/renamed, or a report generated. This is always present.
        </li>
        <li>
          <Badge tone="llm">llm</Badge> (orange) or <Badge tone="llm-none">llm</Badge> (grey, &quot;0
          calls&quot;) — whether, and how many times, an LLM was actually called for that action.
        </li>
      </ul>
      <p>
        <strong>Why this split exists:</strong> Construct&apos;s design is that almost everything —
        scaffolding features/layers/vertical slices, moving/renaming files, summarizing a feature,
        checking the environment, tracing a route&apos;s import graph, writing TODO(import) breadcrumbs
        — is 100% deterministic tooling with no LLM involved at all. An LLM is called only in the
        two places it&apos;s explicitly opted into:
      </p>
      <ul>
        <li>
          <code>import --llm &lt;provider&gt;</code> (Dashboard&apos;s Import panel, &quot;Have the LLM write
          the ported logic&quot; checkbox) — one call per generated file, never one call for a whole
          batch, each with that file&apos;s own layer constraints and the old source.
        </li>
        <li>
          The Import Wizard&apos;s <strong>one</strong> combined analysis call — proposing the whole
          plan (which old files map to which new layers) across every traced route at once, before
          anything is written, and (only if you opt in when asked) the same per-file write-up as
          above once you approve the plan.
        </li>
      </ul>
      <p>
        Nowhere else does Construct call an LLM — not <code>create</code>, not{' '}
        <code>refactor</code>, not <code>research</code>, not import&apos;s default (breadcrumb-only)
        mode. The badges exist so that&apos;s never ambiguous from the UI: you can always see, per
        action, exactly what a deterministic tool did versus what (if anything) an LLM did, rather
        than a single collapsed &quot;done&quot; toast that hides which parts of the result to trust blindly
        and which parts to double check.
      </p>
    </div>
  );
}
