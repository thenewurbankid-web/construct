// #547 (Block 2 of #542's framework) -- availableActions(block, state, catalog, projectCtx): the legal
// action menu at ANY level (app, feature, each layer unit, workflow, page, component, route, controller,
// service, domain, expression, hook/provider), derived, never hand-listed per screen.
//
// Two sources, exactly the ones the issue names, and nothing else:
//   - the layer definition -- `projectCtx.layers` (DEFAULT_LAYERS/REACT_SPA_LAYERS, packages/core/config.mjs)
//     and its `canImport` graph. One "import a <target>" action per edge out of `block.layer`; a target
//     layer NOT in that list is never offered at all -- the graph IS the "not offered" rule, the same one
//     packages/engine/palette.mjs already reads to build a page's own import candidates, generalized to
//     every layer in the graph for free (palette.mjs stays the richer, per-unit-named view for pages).
//   - the rule catalog -- `catalog[block.layer]`, level-specific candidates a canImport edge alone cannot
//     express (a Pages editor "Wrap with..." suggestion gated by PAGE-008's shape rule, not an import-graph
//     edge). A candidate names the rule it comes from, so a disabled one always carries `{rule, why}`
//     (block-contract.mjs's own ACTION_WHY_MISSING discipline, applied to a level-agnostic menu instead of
///    one block's rule table). `packages/engine/processMachine.mjs`'s `allowedEvents` is the same idea for
//     the process lifecycle -- `processActionCatalog` below turns it into one more catalog row so a caller
//     reads one menu function for every level instead of a bespoke one per level.
//
// Pure: no clock, no filesystem, no model. `state` and the pieces of `catalog`/`projectCtx` a caller passes
// in are computed by real blocks (buildPalette, buildWrapSuggestions, transition) elsewhere; this module
// only shapes them into the menu.
import { DEFAULT_LAYERS } from '../core/config.mjs';
import { PROCESS_EVENTS, transition } from './processMachine.mjs';

/**
 * @typedef {{ layer: string, [k: string]: any }} ActionBlock
 * The unit a menu is being built for. Only `layer` is read here; everything else (a path, a feature name,
 * ...) is level-specific data a catalog candidate's `appliesTo`/`disabledBecause` may read back out.
 *
 * @typedef {{ id: string, kind?: 'mechanical'|'ai'|'free', label: string, rule?: string,
 *   appliesTo?: (block: ActionBlock, state: any, projectCtx: any) => boolean,
 *   disabledBecause?: (block: ActionBlock, state: any, projectCtx: any) => string | null | undefined }} ActionCandidate
 * One row of a level's rule catalog. `appliesTo` decides whether the action is offered at all in this state
 * (default: yes -- the "not offered" case); `disabledBecause` returns the reason it is offered but disabled
 * (falsy means it is available -- the "disabled with why" case).
 *
 * @typedef {{ id: string, kind: 'mechanical'|'ai'|'free', label: string, enabled: boolean, disabledBecause?: { rule: string|null, why: string } }} AvailableAction
 */

/**
 * The legal action menu for one block at one level: every layer-graph import edge out of `block.layer`,
 * plus every catalog candidate for that layer that applies here.
 *
 * @param {ActionBlock} block The unit this menu is for.
 * @param {any} [state] Whatever a catalog candidate's `disabledBecause` needs (real facts, a wrap-fit
 *   result, a process context, ...) -- callers compute this per level; never read here directly.
 * @param {{ [layer: string]: ActionCandidate[] }} [catalog] The rule catalog: extra candidate actions per
 *   layer that a canImport edge alone cannot express.
 * @param {{ layers?: { [layer: string]: { canImport?: string[] } }, [k: string]: any }} [projectCtx]
 *   Project context; `layers` (default `DEFAULT_LAYERS`) is the layer graph `canImport` is read from, and
 *   the whole object is passed through to every catalog candidate's `appliesTo`/`disabledBecause`.
 * @returns {AvailableAction[]} In graph order (canImport edges first, in their declared order), then
 *   catalog order.
 *
 * @example
 * availableActions({ layer: 'page' }, null, {}, {});
 * // => [{ id: 'import.component', kind: 'mechanical', label: 'Import a component', enabled: true },
 * //     { id: 'import.types', kind: 'mechanical', label: 'Import a types', enabled: true }]
 */
export function availableActions(block, state, catalog = {}, projectCtx = {}) {
  const layer = block?.layer;
  const layers = projectCtx.layers || DEFAULT_LAYERS;
  const canImport = layers[layer]?.canImport || [];
  const out = [];

  for (const target of canImport) {
    out.push({ id: `import.${target}`, kind: 'mechanical', label: `Import a ${target}`, enabled: true });
  }

  for (const candidate of catalog?.[layer] || []) {
    if (typeof candidate.appliesTo === 'function' && !candidate.appliesTo(block, state, projectCtx)) continue;
    const why = typeof candidate.disabledBecause === 'function' ? candidate.disabledBecause(block, state, projectCtx) : null;
    const action = { id: candidate.id, kind: candidate.kind || 'mechanical', label: candidate.label, enabled: !why };
    if (why) action.disabledBecause = { rule: candidate.rule || null, why: String(why) };
    out.push(action);
  }
  return out;
}

// ---- Pages editor's own rule-catalog row (#547's first consumer) --------------------------------------

/**
 * The `page` layer's rule-catalog row: one candidate per real Palette entry (`buildPalette`, a named unit,
 * not just "a component" -- always enabled, since Palette itself only ever lists what canImport already
 * allows), plus, when a PAGE-008-flagged selection is in scope, one "Auto-extract" candidate and one "Wrap
 * with <Expression>" candidate per `buildWrapSuggestions` suggestion -- disabled with `{rule: 'PAGE-008',
 * why}` for a structurally-mismatched Expression (`wrapFit`'s own `not-a-fit` reason), never invented text.
 *
 * @param {{ providers: object[], expressions: object[], components: object[] }} palette A `buildPalette`
 *   result for this page's feature (packages/engine/palette.mjs).
 * @param {{ hit: { rule: string, [k:string]: any } | null, suggestions: object[] }} [wrapSuggestions] A
 *   `buildWrapSuggestions` result for the current selection, or `{hit: null, suggestions: []}` (default)
 *   when nothing is selected.
 * @returns {ActionCandidate[]}
 */
export function pageActionCatalog(palette, wrapSuggestions = { hit: null, suggestions: [] }) {
  const out = [];
  for (const kind of ['providers', 'expressions', 'components']) {
    for (const entry of palette?.[kind] || []) {
      out.push({ id: `import.${kind}.${entry.name}`, kind: 'mechanical', label: `Import ${entry.name}` });
    }
  }
  if (wrapSuggestions?.hit) {
    out.push({ id: 'auto-extract', kind: 'mechanical', label: 'Auto-extract to a new Expression' });
    for (const s of wrapSuggestions.suggestions || []) {
      out.push({
        id: `wrap.${s.name}`,
        kind: 'mechanical',
        label: `Wrap with ${s.name}`,
        rule: s.fit === 'not-a-fit' ? wrapSuggestions.hit.rule : undefined,
        disabledBecause: s.fit === 'not-a-fit' ? () => s.reason : undefined,
      });
    }
  }
  return out;
}

// ---- Process lifecycle's own rule-catalog row (a second level, proving this is level-agnostic) --------

const PROCESS_EVENT_LABELS = {
  START: 'Start', PAUSE: 'Pause', RESUME: 'Resume', CANCEL: 'Cancel', RETRY: 'Retry',
  STEP_COMPLETED: 'Step completed', STEP_FAILED: 'Step failed', FINISHED: 'Finished', YIELDED: 'Yielded',
};

/**
 * The `process` layer's rule-catalog row: one candidate per `PROCESS_EVENTS`
 * (packages/engine/processMachine.mjs), disabled with why the same `transition()` interpreter already
 * uses to compute `allowedEvents()` -- this is that same derivation, reshaped so a caller reads it through
 * `availableActions()` like every other level instead of a bespoke process-only function.
 *
 * @returns {ActionCandidate[]}
 */
export function processActionCatalog() {
  return PROCESS_EVENTS.map((event) => ({
    id: event,
    kind: 'mechanical',
    label: PROCESS_EVENT_LABELS[event] || event,
    rule: 'process.lifecycle',
    disabledBecause: (block, state) => (transition(state?.statePath, event, state?.context) ? null : `Not accepted from "${state?.statePath}".`),
  }));
}
