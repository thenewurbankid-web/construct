// Static content — no props, no data dependency. Follows GettingStarted.tsx's
// pattern: one small function per numbered step, all screenshots served from
// ui/client/public/tutorials/route-import/ (real local assets, never
// hotlinked) so this page works with no network access beyond the app
// itself. Condensed from #146/#147's full write-ups for in-product reading.
function ScanAndTrace() {
  return (
    <>
      <h3>1. Scan and trace the old route — no AI involved</h3>
      <p>
        Point <code>construct import --route</code> at a route in an existing, non-Construct app
        (a URL like <code>/products</code>, or the folder that owns its <code>page.tsx</code>).
        Construct traces every file that route actually depends on — its page, the client
        component(s) it renders, the hooks/components those pull in — by walking the real import
        graph with an AST parser. This step reads files and follows imports; it never calls an
        LLM. No plan exists yet and nothing is written.
      </p>
    </>
  );
}

function AiPlanAndApproval() {
  return (
    <>
      <h3>2. One combined AI call proposes a plan</h3>
      <p>
        The full traced file set is handed to <code>claude</code> in a single combined call —
        never one call per file at this stage — which proposes how to reorganize those old files
        into Construct-shaped units (which layers each one becomes). The plan is shown as a table
        and nothing is written to disk yet.
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/route-import/route-import-146-ui-1-plan-proposed.png"
          alt="Import Wizard chat showing a real AI-proposed plan, awaiting approval"
          loading="lazy"
        />
        <figcaption>Import Wizard: a real plan proposed by one combined Claude call, awaiting approval.</figcaption>
      </figure>
      <h3>3. You approve the plan — that&apos;s the only gate</h3>
      <p>
        Nothing is scaffolded until you explicitly approve. If the AI&apos;s proposal looks wrong,
        you decline and nothing is written — there&apos;s no partial or speculative output sitting
        on disk from this step.
      </p>
    </>
  );
}

function DeterministicScaffold() {
  return (
    <>
      <h3>4. Deterministic scaffold</h3>
      <p>
        Once approved, Construct builds the plan into real layer files the exact same
        deterministic way <code>create</code>/<code>import</code> always do, then runs{' '}
        <code>validate</code> automatically so you immediately see what, if anything, is left to
        fix. This step is 100% deterministic tooling — the AI&apos;s job ended at proposing the
        plan; building it is ordinary Construct scaffolding.
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/route-import/route-import-146-ui-2-approved-and-scaffolded.png"
          alt="Import Wizard showing the plan approved and the deterministic scaffold complete"
          loading="lazy"
        />
        <figcaption>Import Wizard: plan approved, files scaffolded, session reports what&apos;s left.</figcaption>
      </figure>
      <p className="hint">
        A plan can occasionally be structurally invalid (e.g. a controller unit with no sibling
        page) — Construct&apos;s own architecture rules (IMPORT-001) catch that at build time as a
        real error, rather than silently writing broken code.
      </p>
    </>
  );
}

function AiWrittenLogicIntro() {
  return (
    <>
      <p>
        By default a scaffolded file is a breadcrumb stub (<code>TODO(import)</code>). Ask for{' '}
        <code>--llm</code> and each generated file gets its own model call — one call per file,
        never one call for the whole batch — to write the real ported logic in, with that file&apos;s
        layer constraints and the old source as context. Two providers work here:
      </p>
      <ul>
        <li>
          <strong>claude</strong> — the same hosted model used for the plan step; typically the
          more complete, more reliably-validating output.
        </li>
        <li>
          <strong>ollama</strong> (local, e.g. <code>qwen2.5-coder:7b</code>) — runs entirely
          on your machine, no network call. Real, but smaller and faster rather than as thorough —
          review its output before trusting it, same as any generated code.
        </li>
      </ul>
    </>
  );
}

function AiWrittenLogicEvidence() {
  return (
    <>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/route-import/route-import-147-ui-1-scaffold-and-ollama-fill.png"
          alt="Import form set to an approved plan file, LLM checkbox ticked, real per-file AI writes via the Ollama provider chosen in Settings"
          loading="lazy"
        />
        <figcaption>
          Dashboard&apos;s &quot;From an approved plan file&quot; Import form: scaffold plus 8 real
          per-file writes via the local Ollama model chosen in Settings, with the tool/llm attribution split.
        </figcaption>
      </figure>
      <p className="hint">
        Equivalent CLI commands: the guided flow is{' '}
        <code>construct import --route /products</code> (run directly from a terminal, not{' '}
        <code>construct repl</code>); to pick a provider for the logic-writing step from an
        already-approved plan file, use{' '}
        <code>construct import --plan plan.json --llm ollama</code>.
      </p>
    </>
  );
}

function AiWrittenLogic() {
  return (
    <>
      <h3>5. Optional: have an AI write the ported logic, not just a TODO</h3>
      <AiWrittenLogicIntro />
      <AiWrittenLogicEvidence />
    </>
  );
}

export function RouteImportTutorial() {
  return (
    <div>
      <p>
        A walkthrough of <code>construct import --route</code> — porting a whole route out of an
        existing, non-Construct codebase into a Construct feature, end to end.
      </p>
      <ScanAndTrace />
      <AiPlanAndApproval />
      <DeterministicScaffold />
      <AiWrittenLogic />
    </div>
  );
}
