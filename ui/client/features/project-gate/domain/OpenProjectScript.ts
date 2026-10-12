// Pure (DOMAIN-001): a request on the Your projects screen as Trace sees it: the tool it needs (line.newProject,
// line.bringIn, line.openProject from the one tool catalog), the registered controls that do it (lit by Trace), and
// Auto's moves on them. Auto stops before Create and Bring it in (`approve`: the person clicks, unless they let Auto
// approve in this session), waits for the person at "Is it private?", and never types an access token: no move here
// ever touches the token field. Opening a project is a read, so Auto may click its card.
import type { AutoAction, TraceMatch, TraceTool } from '../../../lib/lineContract.ts';
import { controlById } from '../../../../../packages/engine/line/controls.mjs';
import type { OpenProjectIntent } from '../types.ts';

const move = (kind: AutoAction['kind'], controlId: string, caption: string, extra: Partial<AutoAction> = {}): AutoAction => ({ kind, controlId, target: null, caption, ...extra });

function newProjectScript(name: string | null, framework: string): { script: AutoAction[]; missing: string | null } {
  const open = move('click', 'open-project.tabNew', 'Open the New project tab.');
  if (!name) return { script: [open], missing: 'What should we call it?' };
  const named = [open, move('type', 'open-project.name', `Type the name ${name}.`, { value: name }), move('click', 'open-project.nameNext', 'Click Next.')];
  if (framework !== 'line') return { script: named, missing: 'Choose the kind under More options, then Next and Create.' };
  return {
    script: [...named, move('click', 'open-project.kind', 'Choose Line project, the recommended kind.'), move('click', 'open-project.kindNext', 'Click Next.'), move('approve', 'open-project.create', 'Click Create when it looks right. Auto stops here unless you let it approve in this session.')],
    missing: null,
  };
}

function bringInScript(link: string | null): { script: AutoAction[]; missing: string | null } {
  const open = move('click', 'open-project.tabGithub', 'Open the From GitHub tab.');
  if (!link) return { script: [open], missing: 'Paste the GitHub link.' };
  return {
    script: [
      open,
      move('type', 'open-project.link', `Paste the link ${link}.`, { value: link }),
      move('click', 'open-project.linkNext', 'Click Next.'),
      move('approve', 'open-project.private', 'Answer "Is it private?" yourself. Only you ever type a token.'),
      move('click', 'open-project.privateNext', 'Click Next.'),
      move('approve', 'open-project.bringIn', 'Click Bring it in when it looks right. Auto stops here unless you let it approve in this session.'),
    ],
    missing: null,
  };
}

function openScript(project: string | null, wanted: string): { script: AutoAction[]; missing: string | null } {
  if (!project) return { script: [], missing: `There is no project called ${wanted} in your workspace.` };
  return { script: [move('click', 'open-project.tabProjects', 'Open the Your projects tab.'), move('click', 'open-project.card', `Open ${project}.`, { target: project })], missing: null };
}

const PLANS: Record<string, { toolId: string; sentence: (i: OpenProjectIntent) => string; plan: (i: OpenProjectIntent) => { script: AutoAction[]; missing: string | null } }> = {
  new: { toolId: 'line.newProject', sentence: () => 'Start a new project.', plan: (i) => (i.kind === 'new' ? newProjectScript(i.name, i.framework) : { script: [], missing: null }) },
  github: { toolId: 'line.bringIn', sentence: () => 'Bring a project in from GitHub.', plan: (i) => (i.kind === 'github' ? bringInScript(i.link) : { script: [], missing: null }) },
  open: { toolId: 'line.openProject', sentence: (i) => (i.kind === 'open' && i.project ? `Open ${i.project}.` : 'Open a project.'), plan: (i) => (i.kind === 'open' ? openScript(i.project, i.wanted) : { script: [], missing: null }) },
};

/** The tool a request needs, with its controls (in the order a person uses them) and Auto's moves; null when the request
 * needs no control (explain, list, a token, or nothing understood). */
export function traceToolFor(intent: OpenProjectIntent): TraceTool | null {
  const p = PLANS[intent.kind];
  if (!p) return null;
  const { script, missing } = p.plan(intent);
  const seen = new Set<string>();
  const controls = script
    .filter((a) => !seen.has(`${a.controlId}:${a.target}`) && seen.add(`${a.controlId}:${a.target}`))
    .map((a) => ({ controlId: a.controlId, target: a.target, screen: 'open-project' as const, label: controlById(a.controlId)?.label ?? a.controlId }));
  return { toolId: p.toolId, from: 'request', stepId: null, args: { ...intent }, sentence: p.sentence(intent), controls, script, missing };
}

/** The request as a TraceMatch (the same shape POST /api/line/trace answers), or null when it needs no control. */
export function traceMatchFor(request: string, intent: OpenProjectIntent): TraceMatch | null {
  const tool = traceToolFor(intent);
  if (!tool) return null;
  return { ok: true, request, tools: [tool], alternatives: [], choice: null, via: 'static', sentence: tool.missing ?? `${tool.sentence} The lit controls do it.` };
}
