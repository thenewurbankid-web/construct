// #549 -- thin REST adapter over packages/core/rules-catalog.mjs: every rule `construct validate`
// can report, with severity resolved against the open project's `architecture.yml` (falls back to
// the built-in default with no override). Read-only, no logic of its own. Feeds #395's Cockpit
// Rules screen (per-project severity toggle composer) and the generated rules doc.
import { listRules } from '../../../packages/core/rules-catalog.mjs';

/** @returns {{status:number, body:object}} */
export const rulesIndex = (root) => ({ status: 200, body: { ok: true, rules: listRules(root) } });
