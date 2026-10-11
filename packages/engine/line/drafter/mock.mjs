// The drafter's mock (contract.mjs): a fixed Draft for any request, so planService, the server and Cockpit can build
// and test against the shape without the static drafter. Two routes (one recommended, one refused with its fix), the
// names held only in `bindings`.
import { LINE_PLAN_TOOLS } from '../contract.mjs';
import { buildIntentCatalog } from './contract.mjs';

/** The catalog over the Line plan tools. */
export const MOCK_CATALOG = Object.freeze(buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name)));

/**
 * A mock drafter: `draft(request)` always answers the same two routes for "add a <library:L1> to <feature:F1>".
 * @returns {{catalog: import('./contract.mjs').IntentEntry[], draft: (request: string) => import('./contract.mjs').Draft}}
 */
export function createMockDrafter() {
  return {
    catalog: MOCK_CATALOG,
    draft(request) {
      const add = { tool: 'line.baseOn', args: { libraryId: '<L1>', feature: '<F1>', name: '<N1>' } };
      const expect = [{ itemExists: { feature: '<F1>', kind: 'components', name: '<N1>' } }, { noNewFindings: true }];
      const delta = [{ op: 'add-node', node: '<F1>/components/<N1>', kind: 'components', layer: 'ui', area: 'feature', feature: '<F1>' }, { op: 'add-edge', type: 'base', from: '<F1>/components/<N1>', to: '<L1>' }];
      return {
        request: String(request).trim() ? 'add a <library:L1> to <feature:F1>' : '',
        slots: { F1: { kind: 'feature', layers: ['ui'] }, L1: { kind: 'library', itemKind: 'components', role: 'atom' }, N1: { kind: 'new', isNew: true } },
        labels: { intent: { id: 'add.component', confidence: 0.9 }, alternatives: [], inCatalog: true, target: 'F1', layers: [{ layer: 'ui', confidence: 0.9 }, { layer: 'library', confidence: 0.3 }], via: 'rules' },
        from: { project: 'p0', feature: 'f0', layers: {} },
        routes: [
          { id: 'base-on:ui:L1>F1', template: 'base-on', label: 'Add a component based on <L1> to <F1>.', intent: 'add.component', scope: { layers: ['ui'], features: ['F1'], library: ['L1'], scope: 'feature' }, steps: [add], expect, pre: [], delta, predicted: { feature: 'f1', project: 'p1' }, cost: { steps: 1, files: 1, layers: 1 }, risk: 'Changes only <F1>.', via: 'template', confidence: 0.9, status: 'ok', refusal: null, invented: [], failed: [] },
          { id: 'new-feature:ui:L1>F2', template: 'new-feature', label: 'Start a new feature <F2> with a component based on <L1>.', intent: 'add.feature', scope: { layers: ['ui'], features: ['F2'], library: ['L1'], scope: 'feature' }, steps: [{ tool: 'line.baseOn', args: { libraryId: '<L1>', feature: '<F2>', name: '<N1>' } }], expect, pre: [], delta, predicted: null, cost: { steps: 1, files: 1, layers: 1 }, risk: 'Creates a new feature folder.', via: 'template', confidence: 0.4, status: 'refused', refusal: { sentence: 'There is no feature "Shop"; pick an existing feature or create its folder under features/ first.', fix: null }, invented: [], failed: [] },
        ],
        dropped: [{ id: 'api', sentence: 'Line has no API or service layer in this project yet, so no route changes one.' }],
        recommended: 'base-on:ui:L1>F1',
        defer: { to: null, sentence: 'The static drafter is confident; no model is needed.' },
        bindings: { F1: 'orders', F2: 'Shop', L1: 'components/Badge', N1: 'OrdersBadge' },
      };
    },
  };
}
