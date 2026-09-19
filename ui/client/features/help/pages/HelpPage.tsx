import type { ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';
import { Attribution } from '../components/Attribution';
import { CliReference } from '../components/CliReference';
import { GettingStarted } from '../components/GettingStarted';
import { ListingDetailsTutorial } from '../components/ListingDetailsTutorial';
import { RouteImportTutorial } from '../components/RouteImportTutorial';
import { SetupSettingsTutorial } from '../components/SetupSettingsTutorial';
import { UiGuide } from '../components/UiGuide';
import type { HelpViewState } from '../types';

export function HelpPage({ topics, ...view }: HelpViewState & { topics: Array<{ id: string; label: string }> }): ReactNode {
  return (
    <div className="page page--screen help-page">
      <h1>Help</h1>
      <p className="hint">
        Everything about Construct — the CLI (pulled live from its own source, not hand-copied) and
        this UI — in one place.
      </p>

      <GlassPanel as="nav" className="help-contents">
        {topics.map((t) => (
          <a key={t.id} href={`#${t.id}`}>
            {t.label}
          </a>
        ))}
      </GlassPanel>

      {/* #162 — each top-level topic is now a native <details>, open by
          default (so the page reads exactly as before on first load, and
          the existing Playwright walkthrough test's `#getting-started`/
          `#cli-reference` visibility assertions keep passing unchanged),
          but individually collapsible so a reader can fold away whatever
          they're not currently using instead of scrolling past it. */}
      <details id="getting-started" className="help-section" open>
        <summary><h2>Getting started</h2></summary>
        <GettingStarted />
      </details>

      <details id="attribution" className="help-section" open>
        <summary><h2>Tool vs LLM attribution</h2></summary>
        <Attribution />
      </details>

      <details id="ui-guide" className="help-section" open>
        <summary><h2>UI guide</h2></summary>
        <UiGuide />
      </details>

      <details id="tutorials" className="help-section" open>
        <summary><h2>Tutorials</h2></summary>
        <p className="hint">
          Full walkthroughs of Construct&apos;s three headline flows, with real screenshots from
          an actual run of each.
        </p>
        <h3>Guided route import</h3>
        <RouteImportTutorial />
        <h3>New user setup and settings</h3>
        <SetupSettingsTutorial />
        <h3>Auto code generation and LLM-assisted implementation</h3>
        <ListingDetailsTutorial />
      </details>

      <details id="cli-reference" className="help-section" open>
        <summary><h2>CLI reference</h2></summary>
        <CliReference {...(view as HelpViewState)} />
      </details>
    </div>
  );
}
