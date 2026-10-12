'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { OpenProjectTab } from '../types';
import '@/lib/line-style.css';
import './open-project.css';

type TabInfo = { id: OpenProjectTab; label: string; control: string };

type NoProjectScreenProps = {
  /** The one folder the server will ever open projects from (under Details). */
  workspaceRoot: string | null;
  /** The previously open project (a real folder in the workspace), offered but never opened automatically. */
  lastProject: string | null;
  opening: boolean;
  error: string | null;
  onOpen: (dir: string) => void;
  /** The tabs, one per workflow, the one on screen, choosing another, and the tab a key press moves to (or null). */
  tabs: ReadonlyArray<TabInfo>;
  tab: OpenProjectTab;
  onTab: (tab: OpenProjectTab) => void;
  tabForKey: (current: OpenProjectTab, key: string) => OpenProjectTab | null;
  /** How many projects the workspace has (null while loading): none shows the empty state instead of the cards. */
  projectCount: number | null;
  /** The project cards (another feature's page, composed by the controller). */
  picker: ReactNode;
  /** The New project question series (another feature's controller, composed by the controller). */
  newProject?: ReactNode;
  /** The From GitHub question series (another feature's controller, composed by the controller). */
  clone?: ReactNode;
  /** The workspace's `shop` sample folder, when there is one: offered as a one-click open (same open path as the cards). */
  samplePath?: string | null;
  sampleLoading?: boolean;
};

const nameOf = (dir: string) => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir;

function Tabs({ tabs, tab, onTab, tabForKey }: Pick<NoProjectScreenProps, 'tabs' | 'tab' | 'onTab' | 'tabForKey'>) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = tabForKey(tab, e.key);
    if (!to) return;
    e.preventDefault();
    onTab(to);
    document.getElementById(`op-tab-${to}`)?.focus();
  };
  const button = (t: TabInfo) => (
    <button key={t.id} id={`op-tab-${t.id}`} type="button" role="tab" className="ln-tab" aria-selected={tab === t.id} aria-controls={`op-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => onTab(t.id)} data-testid={`open-tab-${t.id}`} data-line-control={t.control}>
      {t.label}
    </button>
  );
  return (
    <div className="ln-tabs" role="tablist" aria-label="What do you want to do?" onKeyDown={onKey}>
      {tabs.map(button)}
    </div>
  );
}

function Panel({ id, tab, children }: { id: OpenProjectTab; tab: OpenProjectTab; children: ReactNode }) {
  // Every panel stays mounted, so answers are kept when switching tabs.
  return (
    <div id={`op-panel-${id}`} role="tabpanel" aria-labelledby={`op-tab-${id}`} hidden={tab !== id} className="op-panel" data-testid={`open-panel-${id}`}>
      {children}
    </div>
  );
}

function Reopen({ lastProject, opening, onOpen }: Pick<NoProjectScreenProps, 'lastProject' | 'opening' | 'onOpen'>) {
  if (!lastProject) return null;
  return (
    <button type="button" className="ln-btn" onClick={() => onOpen(lastProject)} disabled={opening} data-testid="reopen-project">
      Reopen {nameOf(lastProject)}
    </button>
  );
}

function Sample({ samplePath, opening, onOpen }: Pick<NoProjectScreenProps, 'samplePath' | 'opening' | 'onOpen'>) {
  if (!samplePath) return null;
  return (
    <span className="op-sample" data-testid="sample-shop">
      <button type="button" className="ln-btn" onClick={() => onOpen(samplePath)} disabled={opening} data-testid="open-sample-shop">
        Try the sample shop
      </button>
      <span className="ln-muted">A small demo app to look around in.</span>
    </span>
  );
}

function Projects({ projectCount, picker, onTab }: Pick<NoProjectScreenProps, 'projectCount' | 'picker' | 'onTab'>) {
  if (projectCount !== 0) return <>{picker}</>;
  return (
    <div className="op-empty" data-testid="projects-empty">
      <p>No projects yet. Start one in a click.</p>
      <button type="button" className="ln-btn ln-btn--primary" onClick={() => onTab('new')} data-testid="projects-empty-new">
        New project
      </button>
    </div>
  );
}

function OpenError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="ln-q-error" role="alert">
      {error}
    </p>
  );
}

function WorkspaceDetails({ workspaceRoot }: { workspaceRoot: string | null }) {
  if (!workspaceRoot) return null;
  return (
    <details className="ln-details op-details" data-testid="workspace-details">
      <summary>Details</summary>
      <p>
        Projects live in <code>{workspaceRoot}</code>
      </p>
    </details>
  );
}

/** Presentation-only "Open a project" screen (#365): the Cockpit starts with nothing open and never loads the directory
 * it was launched from. Projects first, as cards; a tab per workflow (Your projects, New project, From GitHub) kept in
 * the URL; plain words, with the workspace folder under Details. */
export function NoProjectScreen(p: NoProjectScreenProps) {
  return (
    <div className="page page--screen">
      <div className="ln op" data-testid="no-project">
        <header className="op-head">
          <h1 className="op-title">Your projects</h1>
          <p className="ln-muted">Open one, start a new one, or bring one in from GitHub.</p>
        </header>
        <Tabs tabs={p.tabs} tab={p.tab} onTab={p.onTab} tabForKey={p.tabForKey} />
        <OpenError error={p.error} />
        <Panel id="projects" tab={p.tab}>
          <div className="op-shortcuts">
            <Reopen lastProject={p.lastProject} opening={p.opening} onOpen={p.onOpen} />
            <Sample samplePath={p.samplePath} opening={p.opening} onOpen={p.onOpen} />
          </div>
          <Projects projectCount={p.projectCount} picker={p.picker} onTab={p.onTab} />
        </Panel>
        <Panel id="new" tab={p.tab}>
          {p.newProject}
        </Panel>
        <Panel id="github" tab={p.tab}>
          {p.clone}
        </Panel>
        <WorkspaceDetails workspaceRoot={p.workspaceRoot} />
      </div>
    </div>
  );
}
