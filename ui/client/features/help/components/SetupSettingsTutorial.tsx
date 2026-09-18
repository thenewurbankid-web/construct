// Static content — no props, no data dependency. Follows GettingStarted.tsx's
// pattern: one small function per step, all screenshots served from
// ui/client/public/tutorials/setup-settings/ (real local assets, never
// hotlinked). Condensed from #149/#150's full write-ups for in-product
// reading.
function InitAProject() {
  return (
    <>
      <h3>1. Go from an empty directory to a working project</h3>
      <p>
        <code>construct init [dir]</code> scaffolds <code>architecture.yml</code>,{' '}
        <code>AGENTS.md</code>, and a starter <code>core</code> feature, plus a framework-specific
        entry point — <code>app/page.tsx</code> for the default (<code>nextjs</code>), or{' '}
        <code>src/main.tsx</code>/<code>src/App.tsx</code> for{' '}
        <code>--framework react-spa</code>. An unknown framework value is rejected with a clear
        error instead of being silently ignored.
      </p>
      <p className="hint">
        Honest note: the scaffolded entry point already imports a <code>CoreController</code>{' '}
        that <code>init</code> doesn&apos;t itself create — run{' '}
        <code>construct create controller Core --feature core</code> (or similar) afterward to
        make a fresh project actually buildable.
      </p>
    </>
  );
}

function ProjectGateFlow() {
  return (
    <>
      <h3>2. The UI&apos;s own project gate</h3>
      <p>
        The Cockpit UI never shells out to the CLI — every gated screen (Dashboard, Import
        Wizard, Pages Editor) checks whether the currently-selected project directory resolves to
        a real Construct project, the same way the CLI finds its root. Point it at a directory
        with no <code>architecture.yml</code> anywhere above it, and you get a gate screen instead
        of a broken page:
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/149-1-gate-not-initialized.png"
          alt="ProjectGate screen reading 'No Construct project here yet'"
          loading="lazy"
        />
        <figcaption>ProjectGate: no architecture.yml found for the selected directory.</figcaption>
      </figure>
      <p>
        Clicking <strong>Initialize Construct here</strong> runs the exact same <code>init()</code>{' '}
        function the CLI uses, in-process, then re-checks status — unblocking the Dashboard with
        no separate step:
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/149-2-gate-initialized-dashboard.png"
          alt="Dashboard rendering after a real init triggered from the UI"
          loading="lazy"
        />
        <figcaption>Dashboard, unblocked immediately after a real init from the UI.</figcaption>
      </figure>
    </>
  );
}

function ProjectDirectorySwitching() {
  return (
    <>
      <h3>3. Settings: switching project directory</h3>
      <p>
        The Settings page is where every session-wide choice for this UI lives: which project
        directory commands run against, and which LLM provider each capability uses.
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/150-1-settings-initial.png"
          alt="Settings page in its initial state"
          loading="lazy"
        />
        <figcaption>Settings: initial state.</figcaption>
      </figure>
      <p>Point &quot;Project directory&quot; at a different, already-initialized Construct project and save:</p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/150-2-settings-project-dir-switched.png"
          alt="Settings page after switching the project directory"
          loading="lazy"
        />
        <figcaption>Settings: project directory switched, resolved root updates immediately.</figcaption>
      </figure>
    </>
  );
}

function PerCapabilityProvider() {
  return (
    <>
      <h3>4. Per-capability LLM provider</h3>
      <p>
        Three distinct capabilities can each choose a provider independently —{' '}
        <code>importFill</code>, <code>createFill</code>, and <code>planAnalysis</code> — every
        option validated live against the CLI&apos;s own provider list, never a UI-side copy that
        could drift. <code>importFill</code>/<code>createFill</code> both accept a local model via{' '}
        Ollama (e.g. <code>qwen2.5-coder:7b</code>):
      </p>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/150-3-settings-ollama-selected.png"
          alt="Settings page with importFill and createFill set to ollama"
          loading="lazy"
        />
        <figcaption>Settings: importFill and createFill set to a local Ollama model.</figcaption>
      </figure>
    </>
  );
}

function PlanAnalysisGuardrail() {
  return (
    <>
      <h3>5. The planAnalysis guardrail — a real safety behavior, not just documentation</h3>
      <p>
        <code>planAnalysis</code> is different on purpose: the whole-feature plan-analysis call
        (the one combined call in the route-import wizard) is deliberately Claude/hosted-model-only
        and can never be delegated to a local model, even by explicit request. This is enforced
        twice, independently:
      </p>
      <ul>
        <li>The provider dropdown for <code>planAnalysis</code> never renders an &quot;ollama&quot; option at all — it can&apos;t be picked through normal interaction.</li>
        <li>
          Even a direct API request bypassing the UI is hard-rejected server-side with a real{' '}
          <code>HTTP 400</code> and the value left unchanged — not merely hidden in the form.
        </li>
      </ul>
      <figure className="tutorial-figure">
        <img
          className="tutorial-screenshot"
          src="/tutorials/setup-settings/150-4-settings-plananalysis-ollama-rejected.png"
          alt="Settings page confirming a direct attempt to set planAnalysis to ollama was rejected"
          loading="lazy"
        />
        <figcaption>Settings: a direct planAnalysis=ollama request rejected; value held unchanged.</figcaption>
      </figure>
      <p className="hint">
        Equivalent CLI commands:{' '}
        <code>construct init /path/to/new-project [--framework nextjs|react-spa]</code>. There is
        no CLI equivalent for project directory or per-capability provider selection — those are
        UI-only, backed by <code>GET</code>/<code>POST /api/settings</code>.
      </p>
    </>
  );
}

export function SetupSettingsTutorial() {
  return (
    <div>
      <p>
        A walkthrough of first-run setup — from an empty directory to a working Construct project
        — and the Settings page that governs every session-wide choice this UI makes.
      </p>
      <InitAProject />
      <ProjectGateFlow />
      <ProjectDirectorySwitching />
      <PerCapabilityProvider />
      <PlanAnalysisGuardrail />
    </div>
  );
}
