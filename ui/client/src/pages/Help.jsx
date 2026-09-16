import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Groupings purely for presentation — the actual list of topics (and their
// order) comes from the backend's /api/help, which re-exports the REPL's
// own TOPIC_ORDER. This just buckets that same list into "the four grouped
// capabilities", "flat equivalents", and "reference topics" so the CLI
// reference below reads as sections instead of one long flat list.
const GROUPED = ['create', 'refactor', 'research', 'import'];
const FLAT = ['init', 'feature', 'generate', 'sync', 'validate', 'summarize', 'doctor'];

const TOPIC_TITLES = {
  create: 'create — scaffold a feature, layer, or vertical slice',
  refactor: 'refactor — mechanical, LLM-free moves/renames',
  research: 'research — read-only summarize / doctor',
  import: 'import — port an existing, non-Construct file',
  init: 'init — bootstrap a new project',
  feature: 'feature — flat form of "create feature"',
  generate: 'generate — flat form of "create <layer>" / "create layer"',
  sync: 'sync — regenerate dependency-cruiser config + public APIs',
  validate: 'validate — run every enforcer and report violations',
  summarize: 'summarize — flat form of "research summarize"',
  doctor: 'doctor — flat form of "research doctor"',
  dir: '--dir — targeting a nested project',
  'import-001': 'IMPORT-001 — why build order is enforced',
};

function CliTopic({ id, title, text }) {
  return (
    <div className="help-topic" id={`cli-${id}`}>
      <h4>{title}</h4>
      <pre className="command-output help-pre">{text}</pre>
    </div>
  );
}

function CliReference() {
  const [help, setHelp] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getHelp()
      .then(setHelp)
      .catch((e) => setError(e.message || 'Failed to load CLI help from the backend.'));
  }, []);

  if (error) {
    return (
      <p className="status-error">
        Could not load the live CLI reference from the backend ({error}). Start{' '}
        <code>ui/server</code> and reload this page — the text below is generated from{' '}
        <code>src/usage.mjs</code> and <code>src/repl.mjs</code>, not hand-copied, so it needs the
        backend running to fetch it.
      </p>
    );
  }
  if (!help) return <p>Loading the CLI's own help text from the backend…</p>;

  const rest = help.topics.filter((t) => !GROUPED.includes(t) && !FLAT.includes(t));

  return (
    <div>
      <p className="hint">
        Everything below is fetched live from <code>GET /api/help</code>, which returns text
        imported directly from <code>src/usage.mjs</code> (the one-shot CLI's usage banner) and{' '}
        <code>src/repl.mjs</code>'s <code>HELP_TOPICS</code>/<code>getTopLevelHelpText()</code> —
        the exact same strings <code>construct</code> (no args) and{' '}
        <code>construct repl</code>'s <code>help</code>/<code>help &lt;topic&gt;</code> print. This
        page can't drift from the real CLI because it never re-describes it — it just renders the
        source of truth.
      </p>

      <h3>Top-level overview (what `construct` with no args prints)</h3>
      <pre className="command-output help-pre">{help.usage}</pre>

      <h3>REPL top-level help (`construct repl`, then `help`)</h3>
      <p className="hint">
        Run <code>construct repl</code> for an interactive shell that keeps a project directory
        across commands (via <code>cd</code>) instead of passing <code>--dir</code> every time,
        and has this same detailed help built in.
      </p>
      <pre className="command-output help-pre">{help.topLevelHelp}</pre>

      <h3>The four grouped capabilities</h3>
      {GROUPED.map((id) => (
        <CliTopic key={id} id={id} title={TOPIC_TITLES[id] || id} text={help.helpTopics[id]} />
      ))}

      <h3>Flat equivalents (unchanged, still supported)</h3>
      <p className="hint">
        Every grouped command above has an older, flat equivalent that still works exactly as
        before — <code>create feature</code> and <code>feature create</code> do the same thing.
      </p>
      {FLAT.map((id) => (
        <CliTopic key={id} id={id} title={TOPIC_TITLES[id] || id} text={help.helpTopics[id]} />
      ))}

      {rest.length > 0 && (
        <>
          <h3>Reference topics</h3>
          {rest.map((id) => (
            <CliTopic key={id} id={id} title={TOPIC_TITLES[id] || id} text={help.helpTopics[id]} />
          ))}
        </>
      )}
    </div>
  );
}

function GettingStarted() {
  return (
    <div>
      <h3>1. Create your first feature</h3>
      <ol>
        <li>
          Open the <strong>Dashboard</strong> and find the <strong>Create</strong> panel (top-left
          card).
        </li>
        <li>
          Leave "What to scaffold" on <em>A new feature (all 7 layer folders)</em>.
        </li>
        <li>
          Type a name, e.g. <code>billing</code>, into <strong>Name</strong>.
        </li>
        <li>
          Click <strong>Run create</strong>.
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

      <h3>2. Scaffold a full vertical slice</h3>
      <p>
        A "vertical slice" is one logical unit (e.g. a single price-check feature) built across
        several architectural layers in one shot, always in dependency order regardless of the
        order you pick them in.
      </p>
      <ol>
        <li>
          In the same <strong>Create</strong> panel, change "What to scaffold" to{' '}
          <em>A vertical slice (several layers of one logical unit)</em>.
        </li>
        <li>
          Fill in <strong>Name</strong> (e.g. <code>PriceCheck</code>) and{' '}
          <strong>Feature</strong> (e.g. <code>billing</code> — the feature you created in step 1).
        </li>
        <li>
          Check the layers you want under "Layers" — e.g. <code>domain</code>,{' '}
          <code>hook</code>, <code>controller</code>. They'll be generated in dependency order
          (domain → service → workflow → hook → component → page → controller) no matter which
          order you tick the boxes in — this is enforced for real by rule IMPORT-001, not just a
          UI convenience.
        </li>
        <li>
          Click <strong>Run create</strong> and read the result panel the same way as step 1 — one
          line per generated file, then the tool/llm attribution split (llm again reads{' '}
          <code>0 calls</code>; scaffolding is always deterministic).
        </li>
      </ol>
      <p className="hint">
        Equivalent CLI command:{' '}
        <code>construct create layer PriceCheck --feature billing --layers domain,hook,controller</code>.
      </p>

      <h3>3. Run the guided import wizard end-to-end for a real Next.js route</h3>
      <p>
        Use this when you're porting a whole route (page + its client component + hooks/
        components it pulls in) out of an existing, non-Construct codebase. Go to the{' '}
        <strong>Import Wizard</strong> page for this — the Dashboard's "Import" panel is for a
        single already-known file or an already-approved plan file, not this guided flow.
      </p>
      <ol>
        <li>
          Before starting: set the <strong>project directory</strong> on the{' '}
          <strong>Settings</strong> page to the Construct project you're importing into (the
          wizard has no <code>--dir</code> flag of its own — it uses whatever Settings has
          configured, applied once when the session starts).
        </li>
        <li>
          On the <strong>Import Wizard</strong> page, optionally type a seed route into "Seed
          route" — e.g. <code>/v2/home</code> (a URL) or a path to the route's folder — then click{' '}
          <strong>Start wizard session</strong>. You can also leave it blank and answer the first
          question in chat instead.
        </li>
        <li>
          The wizard asks its questions as chat bubbles, one at a time — answer each in the text
          box at the bottom and press <strong>Send</strong>:
          <ul>
            <li>
              <em>"Destination feature (Construct feature name): "</em> — the feature this route's
              logic should land in. If it doesn't exist yet, the wizard creates it for you; if it
              already exists, it's left untouched.
            </li>
            <li>
              <em>"Path to your Next.js app/ directory…"</em> — only asked for a URL-style route
              (not a folder path), and only once per session; it guesses <code>app</code> or{' '}
              <code>src/app</code> if one exists, shown as a default.
            </li>
            <li>
              <em>"Route to import…"</em>, then <em>"Another route to include (leave blank to
              finish…)"</em> — keep adding routes if the old feature spans more than one (e.g.{' '}
              <code>/v2/home</code> and <code>/v2/home/details</code>); leave the answer blank once
              you've listed them all.
            </li>
            <li>
              <em>"After you approve the plan, should the LLM also write the ported logic…?
              [y/N]"</em> — answer <code>y</code> to have the LLM write real ported code per file,
              or <code>N</code>/blank to get TODO(import) breadcrumbs you fill in yourself.
            </li>
          </ul>
        </li>
        <li>
          Progress log bubbles stream in as they happen: the files traced across the route's real
          import graph, then <em>"Analyzing via 'claude' — one LLM call for a single combined plan
          across all of them, nothing is written yet…"</em> followed by an attribution bubble
          showing that one LLM call (the orange <strong>llm</strong> badge), then the proposed plan
          as a table (which unit goes to which layers, from which old file).
        </li>
        <li>
          You're asked <em>"Approve this plan and build it now? [y/N]"</em> — review the plan
          table first; answering <code>N</code> cancels with nothing written.
        </li>
        <li>
          On approval, the files are scaffolded, another attribution bubble shows the tool-work
          (and, if you opted in, further LLM calls — one per generated file, never one for the
          whole batch), <code>validate</code> runs automatically and its results are shown, and a
          final line tells you exactly what's left: either a count of files with a{' '}
          <code>TODO(import)</code> marker still to fill in, or a reminder to review the
          LLM-written files against their source before trusting them.
        </li>
      </ol>
      <p className="hint">
        Equivalent CLI command (run directly from a terminal, not inside <code>construct repl</code>
        , since it manages its own input the same way this chat does):{' '}
        <code>construct import --route /v2/home</code>.
      </p>
    </div>
  );
}

function Attribution() {
  return (
    <div>
      <p>
        Every command's result — on the Dashboard, and as chat bubbles in the Import Wizard — ends
        with two labeled rows instead of one generic "success" message:
      </p>
      <ul>
        <li>
          <span className="attribution-label tool">tool</span> what Construct's own deterministic
          code did — files created/moved/renamed, or a report generated. This is always present.
        </li>
        <li>
          <span className="attribution-label llm">llm</span> (orange) or{' '}
          <span className="attribution-label llm-none">llm</span> (grey, "0 calls") — whether, and
          how many times, an LLM was actually called for that action.
        </li>
      </ul>
      <p>
        <strong>Why this split exists:</strong> Construct's design is that almost everything —
        scaffolding features/layers/vertical slices, moving/renaming files, summarizing a feature,
        checking the environment, tracing a route's import graph, writing TODO(import) breadcrumbs
        — is 100% deterministic tooling with no LLM involved at all. An LLM is called only in the
        two places it's explicitly opted into:
      </p>
      <ul>
        <li>
          <code>import --llm &lt;provider&gt;</code> (Dashboard's Import panel, "Have the LLM write
          the ported logic" checkbox) — one call per generated file, never one call for a whole
          batch, each with that file's own layer constraints and the old source.
        </li>
        <li>
          The Import Wizard's <strong>one</strong> combined analysis call — proposing the whole
          plan (which old files map to which new layers) across every traced route at once, before
          anything is written, and (only if you opt in when asked) the same per-file write-up as
          above once you approve the plan.
        </li>
      </ul>
      <p>
        Nowhere else does Construct call an LLM — not <code>create</code>, not{' '}
        <code>refactor</code>, not <code>research</code>, not import's default (breadcrumb-only)
        mode. The badges exist so that's never ambiguous from the UI: you can always see, per
        action, exactly what a deterministic tool did versus what (if anything) an LLM did, rather
        than a single collapsed "done" toast that hides which parts of the result to trust blindly
        and which parts to double check.
      </p>
    </div>
  );
}

function UiGuide() {
  return (
    <div>
      <h3>Dashboard</h3>
      <p>Four independent forms, one per capability. Each has its own result panel.</p>
      <ul>
        <li>
          <strong>Create</strong> — scaffold a new feature (all 7 layer folders), a vertical slice
          (several layers of one logical unit, built in dependency order), or a single layer file.
          Fill in Name (and Feature/Layer(s) depending on what you picked) and click "Run create".
        </li>
        <li>
          <strong>Refactor</strong> — move a file to a different layer, or rename it within the
          same layer. Mechanical and LLM-free: only the file's location/name and every import of it
          are rewritten, never its content or exported identifier. Fill in Name (and New name for
          rename), Feature, and the layer(s) involved, then click "Run refactor".
        </li>
        <li>
          <strong>Research</strong> — read-only. "Doctor" checks your environment/tooling (node/npm
          versions, whether <code>architecture.yml</code> is present, which enforcer modules are
          available) with no inputs needed. "Summarize" produces an English or JSON/Markdown
          summary of one feature (or the whole project if left blank) — pick a Format, optionally
          scope with "Since" (a git ref) to only what changed since then.
        </li>
        <li>
          <strong>Import (non-interactive)</strong> — for a single already-known old file ("Single
          unit": name, feature, layers, and the path to the old file) or an already-approved plan
          file ("From an approved plan file": just its path). Check "Have the LLM write the ported
          logic" to get real ported code instead of TODO(import) breadcrumbs — this is the one
          place on this form an LLM is called, once per generated file. For the guided, chat-style
          whole-route flow, use the Import Wizard page instead.
        </li>
      </ul>

      <h3>Settings</h3>
      <p>
        Two settings, applied to every command run from this UI (Dashboard actions and the Import
        Wizard) — nothing is persisted to disk, so restarting the backend resets both to their
        defaults:
      </p>
      <ul>
        <li>
          <strong>Project directory</strong> — passed as <code>--dir</code> to every command,
          exactly like the CLI's own <code>--dir</code> flag. Must already exist as a directory;
          it doesn't need <code>architecture.yml</code> yet if you're about to scaffold your first
          feature from here.
        </li>
        <li>
          <strong>LLM provider</strong> — sourced live from <code>src/llm.mjs</code>'s{' '}
          <code>PROVIDERS</code> map (currently just <code>claude</code>). Selecting "none" simply
          means LLM steps stay off unless a specific command opts in (the "Have the LLM…" checkbox
          on Import, or the Wizard's own prompts) — it does not disable anything by itself.
        </li>
      </ul>
      <p>The bottom of the page always shows the currently-resolved project root and LLM provider.</p>

      <h3>Import Wizard</h3>
      <p>
        A chat-style, guided version of <code>construct import --route</code>: seed it with a route
        (optional), start the session, and answer its questions as they arrive in the chat. Log
        lines stream in the instant they happen — not batched at the end — and its one analysis LLM
        call is shown as its own attribution bubble, same tool/llm split as everywhere else. Only
        one session may run at a time per backend process; see the <em>Getting started</em> section
        above for a full walkthrough.
      </p>
    </div>
  );
}

export function Help() {
  return (
    <div className="page help-page">
      <h1>Help</h1>
      <p className="hint">
        Everything about Construct — the CLI (pulled live from its own source, not hand-copied) and
        this UI — in one place.
      </p>

      <nav className="help-contents">
        <a href="#getting-started">Getting started</a>
        <a href="#attribution">Tool vs LLM attribution</a>
        <a href="#ui-guide">UI guide</a>
        <a href="#cli-reference">CLI reference</a>
      </nav>

      <section id="getting-started" className="help-section">
        <h2>Getting started</h2>
        <GettingStarted />
      </section>

      <section id="attribution" className="help-section">
        <h2>Tool vs LLM attribution</h2>
        <Attribution />
      </section>

      <section id="ui-guide" className="help-section">
        <h2>UI guide</h2>
        <UiGuide />
      </section>

      <section id="cli-reference" className="help-section">
        <h2>CLI reference</h2>
        <CliReference />
      </section>
    </div>
  );
}
