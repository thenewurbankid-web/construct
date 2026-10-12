#!/usr/bin/env node
// Two modes, live stage: how each tool call of the one tool registry shows on the chat's live stage, generated OFFLINE
// and saved as reviewed static data (ui/client/lib/toolPresentations.json). At runtime the stage only reads that file:
// no model, no jev.
//
//   node packages/tools/tool-presentations/generate.mjs           write the file (rules, then jev where rules cannot decide)
//   node packages/tools/tool-presentations/generate.mjs --check   exit 1 when the file is missing a tool or out of date
//   LINE_PRESENTATION_JEV=off ...                                  rules only (every undecided field gets the rules' default)
//
// Each field is picked from closed options (FIELD_OPTIONS). Rules decide first; only a field the rules leave open goes
// to Line's one decide() (its picker runs only where the step's profile is on and measured). Otherwise the rules'
// default stands and the field is marked "rules". Every field records `by`: 'rules' or 'jev'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_ENTRIES } from '../../engine/line/toolRegistry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const OUT = path.join(ROOT, 'ui/client/lib/toolPresentations.json');

/** The closed options per field (mirrored by ui/client/lib/toolPresentations.ts). */
export const FIELD_OPTIONS = Object.freeze({
  kind: ['feature', 'page', 'component', 'workflow', 'step', 'finding'],
  overlay: ['outline', 'badge', 'ghost-after', 'connector'],
  focus: ['self', 'base', 'feature', 'target'],
  state: ['loading', 'empty', 'error', 'disabled', 'filled'],
});
const ICON = { feature: 'folder', page: 'page', component: 'block', workflow: 'flow', step: 'step', finding: 'flag' };

const has = (id, ...words) => words.some((w) => id.includes(w));

/** The rules' pick for a tool's block kind, or { open: [...] } when more than one kind fits and the rules cannot tell. */
function kindRule(e) {
  const id = e.id;
  if (has(id, 'plan.', 'train.', 'draft.', 'blocks.', 'gatelm.', 'importAgent.', 'line.tools', 'line.aiProfiles', 'line.trace')) return 'step';
  if (has(id, 'Workflow', 'workflows')) return 'workflow';
  if (has(id, '.fix', 'leaveAsIs')) return 'finding';
  if (has(id, 'PageProp', 'Fragment', 'pageTree', 'fragments', 'splitPage', 'createLayout')) return 'page';
  if (has(id, 'render', 'promote', 'toLibrary')) return 'component';
  if (has(id, 'line.project', 'line.feature', 'line.spec', 'newProject', 'orkspace', 'import.', 'toFeature')) return 'feature';
  // Set a base, move a file: a page or a component, depending on the step's own item, which only the call knows. The
  // live stage reads it from the call (ui/client/lib/liveStage.ts itemKindOfCall); jev cannot know it offline (it
  // picked "page" for both), so the rules' default stands.
  if (has(id, 'setBase', 'moveFile')) return 'component';
  // Base on, amend, extract: a page or a component, depending on the item.
  return { open: ['component', 'page'], fallback: 'component' };
}

function overlayRule(e) {
  if (has(e.id, '.fix', 'leaveAsIs')) return 'badge';
  if (has(e.id, 'line.trace', 'draft.', 'gatelm.ask', 'gatelm.answer')) return 'connector';
  if (e.kind === 'write' && e.writes === 'project') return 'ghost-after';
  return 'outline';
}

function focusRule(e, kind) {
  if (has(e.id, '.fix', 'leaveAsIs')) return 'target';
  if (kind === 'feature') return 'feature';
  if (has(e.id, 'setBase')) return 'base';
  if (has(e.id, 'baseOn', 'baseWorkflowOn')) return { open: ['self', 'base'], fallback: 'self' };
  return 'self';
}

function statesRule(e) {
  const list = has(e.id, 'folders', 'cases', 'tools', 'workflows', 'worlds', 'facts', 'find', 'status', 'scoreboard', 'project', 'feature', 'fragments');
  const base = e.kind === 'write' ? ['loading', 'error', 'disabled', 'filled'] : ['loading', 'error', 'filled'];
  return list ? ['loading', 'empty', ...base.slice(1)] : base;
}

/** The caption template: the tool's own one sentence (toolRegistry), with its required fields as {slots}. */
function captionRule(e) {
  const req = e.inputSchema?.required ?? [];
  const slots = req.length ? ` (${req.map((r) => `{${r}}`).join(', ')})` : '';
  return `${e.sentence.replace(/\.$/, '')}${slots}.`;
}

/**
 * A picker over closed options, or null (then the rules' default stands). It goes through Line's one decide()
 * (packages/core/line-decide.mjs) under the `line.presentation` step: the profile is the only switch, so with no
 * profile for that step, or the step off, decide() throws or answers from static and the rules' default stands.
 */
async function loadJev() {
  if (process.env.LINE_PRESENTATION_JEV === 'off') return null;
  try {
    const { decide } = await import('../../core/line-decide.mjs');
    const { decideWith } = await import('../../engine/line/importAgent.mjs');
    return async (id, question, options) => {
      const d = await decideWith(decide, 'line.presentation', question, options);
      return d.driver === 'picker' ? d.picked : null;
    };
  } catch {
    return null;
  }
}

async function field(rule, jev, toolId, name, question) {
  if (typeof rule === 'string' || Array.isArray(rule)) return { value: rule, by: 'rules' };
  const picked = jev ? await jev(`presentation.${toolId}.${name}`, question, rule.open) : null;
  return picked && rule.open.includes(picked) ? { value: picked, by: 'jev' } : { value: rule.fallback, by: 'rules' };
}

/** Every registry tool's presentation spec. */
export async function generate(entries = TOOL_ENTRIES, jev = null) {
  const tools = {};
  for (const e of entries) {
    const kind = await field(kindRule(e), jev, e.id, 'kind', `Which part does "${e.sentence}" show on the stage?`);
    const focus = await field(focusRule(e, kind.value), jev, e.id, 'focus', `Which part should "${e.sentence}" focus?`);
    tools[e.id] = {
      kind,
      icon: { value: ICON[kind.value], by: 'rules' },
      overlay: { value: overlayRule(e), by: 'rules' },
      states: { value: statesRule(e), by: 'rules' },
      focus,
      caption: { value: captionRule(e), by: 'rules' },
    };
  }
  return { version: 1, note: 'Generated by packages/tools/tool-presentations/generate.mjs; reviewed static data, read by the live stage at runtime.', options: FIELD_OPTIONS, tools };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) {
    const saved = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const missing = TOOL_ENTRIES.filter((e) => !saved.tools[e.id]).map((e) => e.id);
    if (missing.length) {
      console.error(`toolPresentations.json has no spec for: ${missing.join(', ')}. Run node packages/tools/tool-presentations/generate.mjs.`);
      process.exit(1);
    }
    console.log(`toolPresentations.json covers all ${TOOL_ENTRIES.length} tools.`);
  } else {
    const jev = await loadJev();
    const doc = await generate(TOOL_ENTRIES, jev);
    fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
    const byJev = Object.values(doc.tools).flatMap((t) => Object.values(t)).filter((f) => f.by === 'jev').length;
    console.log(`Wrote ${path.relative(ROOT, OUT)}: ${Object.keys(doc.tools).length} tools, ${byJev} fields picked by jev${jev ? '' : ' (jev not running: rules only)'}.`);
  }
}
