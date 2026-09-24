export type WizardId = string;

/** `step` = a framework block starting (deterministic Construct); `thought` = the model's own streamed
 * output (#599). Kept as two roles so they are never confused on screen. */
export type ChatRole = 'log' | 'question' | 'answer' | 'error' | 'system' | 'step' | 'thought';

export type ChatMessageData = {
  id: number;
  role: ChatRole;
  text: string;
  /** Pre-parsed from a "[tool: ...] [llm: ...]" log line at creation time
   * (see workflows/Wizard.tsx) — presentational components never parse
   * this themselves (COMPONENT-003 bans importing domain). */
  attribution?: { tool: string; llm: string } | null;
  /** For a `step` message: the framework's own reason for this block (why it does what it does), shown
   * under the step line so the deterministic side explains itself the way the model's stream does (#599). */
  reason?: string;
};

/** What a question wants as its answer, when it wants a project path (#600): a route (folder with a page, or a code file) or any folder. */
export type PathExpectation = 'route' | 'dir';

/** One row of the project picker, as ui/server's GET /api/project/tree returns it. */
export type ProjectTreeEntry = { name: string; path: string; kind: 'dir' | 'file'; route: boolean };

export type ProjectTree = { path: string; parent: string | null; entries: ProjectTreeEntry[]; truncated?: boolean };

export type WizardStatus = 'connecting' | 'idle' | 'running' | 'done' | 'closed';

/** Messages exchanged with ui/server's /ws/wizard endpoint (see
 * ui/server/src/wizardSocket.mjs). */
export type ServerWizardEvent =
  | { type: 'question'; text: string; expects?: PathExpectation }
  | { type: 'log'; text: string; kind?: string }
  | { type: 'step'; phase: string; detail?: Record<string, unknown>; reason?: string }
  | { type: 'thought'; text: string }
  | { type: 'done' };

export type ClientWizardEvent = { type: 'start'; seedRoute?: string; planner?: 'ai' | 'mechanical' } | { type: 'answer'; text: string } | { type: 'cancel' };
