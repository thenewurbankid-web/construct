import type { ReactNode } from 'react';
import { GlassPanel } from '@/components/ui';
import { Attribution } from '../components/Attribution';
import { CliReference } from '../components/CliReference';
import { GettingStarted } from '../components/GettingStarted';
import { UiGuide } from '../components/UiGuide';
import type { HelpViewState } from '../types';

export function HelpPage(view: HelpViewState): ReactNode {
  return (
    <div className="page help-page">
      <h1>Help</h1>
      <p className="hint">
        Everything about Construct — the CLI (pulled live from its own source, not hand-copied) and
        this UI — in one place.
      </p>

      <GlassPanel as="nav" className="help-contents">
        <a href="#getting-started">Getting started</a>
        <a href="#attribution">Tool vs LLM attribution</a>
        <a href="#ui-guide">UI guide</a>
        <a href="#cli-reference">CLI reference</a>
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

      <details id="cli-reference" className="help-section" open>
        <summary><h2>CLI reference</h2></summary>
        <CliReference {...view} />
      </details>
    </div>
  );
}
