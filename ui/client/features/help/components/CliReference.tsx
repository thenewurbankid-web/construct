import { ErrorState, LoadingState } from '@/features/states';
import type { HelpViewState, TopicSection } from '../types';
import { CliTopic } from './CliTopic';

function LoadedState(view: Extract<HelpViewState, { status: 'loaded' }>) {
  return (
    <div>
      <p className="hint">
        Everything below is fetched live from <code>GET /api/help</code>, which returns text
        imported directly from <code>src/usage.mjs</code> (the one-shot CLI&apos;s usage banner) and{' '}
        <code>src/repl.mjs</code>&apos;s <code>HELP_TOPICS</code>/<code>getTopLevelHelpText()</code> —
        the exact same strings <code>construct</code> (no args) and{' '}
        <code>construct repl</code>&apos;s <code>help</code>/<code>help &lt;topic&gt;</code> print. This
        page can&apos;t drift from the real CLI because it never re-describes it — it just renders the
        source of truth.
      </p>

      <h3>Top-level overview (what `construct` with no args prints)</h3>
      <pre className="command-output help-pre">{view.usage}</pre>

      <h3>REPL top-level help (`construct repl`, then `help`)</h3>
      <p className="hint">
        Run <code>construct repl</code> for an interactive shell that keeps a project directory
        across commands (via <code>cd</code>) instead of passing <code>--dir</code> every time,
        and has this same detailed help built in.
      </p>
      <pre className="command-output help-pre">{view.topLevelHelp}</pre>

      <h3>The four grouped capabilities</h3>
      {view.grouped.map((t) => <CliTopic key={t.id} {...t} />)}

      <h3>Flat equivalents (unchanged, still supported)</h3>
      <p className="hint">
        Every grouped command above has an older, flat equivalent that still works exactly as
        before — <code>create feature</code> and <code>feature create</code> do the same thing.
      </p>
      {view.flat.map((t) => <CliTopic key={t.id} {...t} />)}

      <ReferenceTopics topics={view.rest} />
    </div>
  );
}

function ReferenceTopics({ topics }: { topics: TopicSection[] }) {
  if (topics.length === 0) return null;
  return (
    <>
      <h3>Reference topics</h3>
      {topics.map((t) => <CliTopic key={t.id} {...t} />)}
    </>
  );
}

// Presentation-only: every section list arrives pre-computed via props
// (from the hook) — this component never imports the domain or workflow
// layers itself (COMPONENT-002, COMPONENT-003).
export function CliReference(view: HelpViewState) {
  if (view.status === 'error') {
    return (
      <ErrorState
        size="inline"
        title="Could not load the live CLI reference"
        hint={`The backend did not provide it (${view.message}). Start ui/server and reload this page: the reference is generated from the CLI's own source, so it needs the backend running.`}
      />
    );
  }
  if (view.status === 'loading') return <LoadingState size="inline" label="Loading the CLI reference" hint="Fetching the CLI's own help text from the backend." />;
  return <LoadedState {...view} />;
}
