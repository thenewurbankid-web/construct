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
        <CliReference {...view} />
      </section>
    </div>
  );
}
