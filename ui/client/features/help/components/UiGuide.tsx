function ShellGuide() {
  return (
    <>
      <h3>The Cockpit layout</h3>
      <p>
        Every screen sits in the same frame: the <strong>Browser</strong> on the left (find things), the{' '}
        <strong>stage</strong> in the middle (the screen itself), and <strong>Tools</strong> on the right
        (inspect, edit, check). A screen&apos;s own tabs come first in the Browser. The top bar has the project
        switcher, the five screens (<strong>Features, Pages, Components, Git, Tests</strong>), the search box
        and the profile menu, which holds Settings, Local model, the theme (Dark, Light or System), Help and
        Sign out.
      </p>
      <ul>
        <li>
          <strong>Command palette</strong> — press <code>Ctrl K</code> (<code>Cmd K</code> on a Mac) to reach
          any screen or action by typing a few letters.
        </li>
        <li>
          <strong>Drawer</strong> — <code>Ctrl J</code> opens the bottom drawer: <em>Diagnostics</em> (what{' '}
          <code>construct validate</code> found, with file and line), <em>Logs</em> and <em>Processes</em>.
        </li>
        <li>
          <strong>Panes</strong> — <code>Ctrl B</code> shows or hides the Browser, <code>Ctrl Alt B</code> the
          Tools panel; drag a divider or use the arrow keys on it to resize. On a narrow window one pane shows
          at a time, switched from the bar at the bottom.
        </li>
      </ul>
    </>
  );
}

function PagesAndWorkflowsGuide() {
  return (
    <>
      <h3>Pages Editor</h3>
      <p>
        Pick a feature and a page in the Browser to see its elements as a tree. Frame your running app in{' '}
        <strong>Live app preview</strong> and click an element to jump to its code. In Tools: <em>Inspector</em>{' '}
        (edit the selected element), <em>Scope</em> (how the page&apos;s values flow into a component),{' '}
        <em>Source</em> (the whole file, with type errors marked) and <em>Diff</em> (what changed on disk
        outside the editor). Every save is previewed and checked against your architecture rules first.
      </p>
      <h3>Workflows</h3>
      <p>
        Pick a workflow file to see its diagram. Tools: <em>Narrative</em> (the flow in plain English, every
        start-to-end scenario, and a health check), <em>Context &amp; actions</em> and <em>Edit</em> (both
        preview a diff before anything is written).
      </p>
    </>
  );
}

function DashboardGuide() {
  return (
    <>
      <h3>Features: stage actions</h3>
      <p>The stage of Features has four actions, one per capability (they were the Dashboard&apos;s forms). Choose one to open its form; each has its own result panel.</p>
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
        Applied to every command run from this UI — nothing is persisted to disk, so restarting the
        backend resets them to their defaults:
      </p>
      <ul>
        <li>
          <strong>Project directory</strong> — the project every command works on, exactly like the CLI&apos;s{' '}
          <code>--dir</code> flag. Type a path or use the folder browser; the project switcher in the top bar
          changes it too.
        </li>
        <li>
          <strong>LLM provider, per capability</strong> — one choice each for Import fill, Create/generate fill
          and Plan analysis. &quot;none&quot; keeps that step off unless a command opts in; a local model is
          offered for the two fill steps but never for Plan analysis.
        </li>
      </ul>
      <p>The bottom of the page always shows the currently-resolved project root and providers.</p>
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
      <ShellGuide />
      <DashboardGuide />
      <PagesAndWorkflowsGuide />
      <SettingsGuide />
      <WizardGuide />
    </div>
  );
}
