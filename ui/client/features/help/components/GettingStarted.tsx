// Static content — no props, no data dependency. Split into three small
// components (one per numbered walkthrough) rather than one long function,
// both for readability and to stay well under READ-002's function-length
// cap.
function CreateFirstFeature() {
  return (
    <>
      <h3>1. Create your first feature</h3>
      <ol>
        <li>
          Open <strong>Features</strong> (the first entry in the left menu) and choose <strong>Create</strong> in the
          stage actions row; its form opens in the stage.
        </li>
        <li>
          Leave &quot;What to scaffold&quot; on <em>A new feature</em>.
        </li>
        <li>
          Type a name, e.g. <code>billing</code>, into <strong>Name</strong>.
        </li>
        <li>
          Click <strong>Create feature</strong>.
        </li>
        <li>
          A result panel appears below the form: the deterministic output (something like{' '}
          <code>Created features/billing/domain, features/billing/service, ...</code>), then two
          attribution rows — a green <strong>tool</strong> row describing exactly what was
          scaffolded, and a grey <strong>llm</strong> row reading <code>0 calls</code> (this
          command never touches an LLM).
        </li>
      </ol>
      <p className="hint">
        Equivalent CLI command: <code>construct create feature billing</code>.
      </p>
    </>
  );
}

function ScaffoldVerticalSlice() {
  return (
    <>
      <h3>2. Scaffold a full vertical slice</h3>
      <p>
        A &quot;vertical slice&quot; is one logical unit (e.g. a single price-check feature) built across
        several architectural layers in one shot, always in dependency order regardless of the
        order you pick them in.
      </p>
      <ol>
        <li>
          In the same <strong>Create</strong> panel, change &quot;What to scaffold&quot; to{' '}
          <em>A vertical slice (several layers of one logical unit)</em>.
        </li>
        <li>
          Fill in <strong>Name</strong> (e.g. <code>PriceCheck</code>) and{' '}
          <strong>Feature</strong> (e.g. <code>billing</code> — the feature you created in step 1).
        </li>
        <li>
          Check the layers you want under &quot;Layers&quot; — e.g. <code>domain</code>,{' '}
          <code>hook</code>, <code>controller</code>. They&apos;ll be generated in dependency order
          (domain → service → workflow → hook → component → page → controller) no matter which
          order you tick the boxes in — this is enforced for real by rule IMPORT-001, not just a
          UI convenience.
        </li>
        <li>
          Click <strong>Create slice</strong> and read the result panel the same way as step 1 — one
          line per generated file, then the tool/llm attribution split (llm again reads{' '}
          <code>0 calls</code>; scaffolding is always deterministic).
        </li>
      </ol>
      <p className="hint">
        Equivalent CLI command:{' '}
        <code>construct create layer PriceCheck --feature billing --layers domain,hook,controller</code>.
      </p>
    </>
  );
}

export function GettingStarted() {
  return (
    <div>
      <CreateFirstFeature />
      <ScaffoldVerticalSlice />
    </div>
  );
}
