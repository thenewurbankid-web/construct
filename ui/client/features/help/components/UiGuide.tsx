function DashboardGuide() {
  return (
    <>
      <h3>Dashboard</h3>
      <p>Four independent forms, one per capability. Each has its own result panel.</p>
      <ul>
        <li>
          <strong>Create</strong> — scaffold a new feature (all 7 layer folders), a vertical slice
          (several layers of one logical unit, built in dependency order), or a single layer file.
        </li>
        <li>
          <strong>Refactor</strong> — move a file to a different layer, or rename it within the
          same layer. Mechanical and LLM-free.
        </li>
        <li>
          <strong>Research</strong> — read-only. &quot;Doctor&quot; checks your environment/tooling;
          &quot;Summarize&quot; produces an English or JSON/Markdown summary of one feature (or the whole
          project).
        </li>
        <li>
          <strong>Import (non-interactive)</strong> — for a single already-known old file or an
          already-approved plan file. For the guided, chat-style whole-route flow, use the Import
          Wizard page instead.
        </li>
      </ul>
    </>
  );
}

function SettingsGuide() {
  return (
    <>
      <h3>Settings</h3>
      <p>
        Two settings, applied to every command run from this UI — nothing is persisted to disk, so
        restarting the backend resets both to their defaults:
      </p>
      <ul>
        <li>
          <strong>Project directory</strong> — passed as <code>--dir</code> to every command,
          exactly like the CLI&apos;s own <code>--dir</code> flag.
        </li>
        <li>
          <strong>LLM provider</strong> — sourced live from <code>src/llm.mjs</code>&apos;s{' '}
          <code>PROVIDERS</code> map. Selecting &quot;none&quot; simply means LLM steps stay off unless a
          specific command opts in.
        </li>
      </ul>
      <p>The bottom of the page always shows the currently-resolved project root and LLM provider.</p>
    </>
  );
}

function WizardGuide() {
  return (
    <>
      <h3>Import Wizard</h3>
      <p>
        A chat-style, guided version of <code>construct import --route</code>: seed it with a route
        (optional), start the session, and answer its questions as they arrive in the chat. Log
        lines stream in the instant they happen — not batched at the end — and its one analysis LLM
        call is shown as its own attribution bubble, same tool/llm split as everywhere else. Each
        browser tab (WebSocket connection) runs its own independent session — log capture is scoped
        per session, so concurrent sessions never cross-talk.
      </p>
    </>
  );
}

export function UiGuide() {
  return (
    <div>
      <DashboardGuide />
      <SettingsGuide />
      <WizardGuide />
    </div>
  );
}
