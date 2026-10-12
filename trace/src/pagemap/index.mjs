// Trace's page map as a package entry (package.json "exports": "./pagemap"): what Construct's Line Cockpit reuses to
// bind a page's parts to API data (cu5, packages/engine/line/pageBinding.mjs). Nothing is copied into Construct; it
// imports these by the package's name. Pure and deterministic, like the modules it re-exports.
//
//   buildInventory      the page's full node tree, with its states (states.mjs) and interactions
//   collapse, classify  repetition and the proposed class of every node (data, static copy, list, action, input)
//   resolveInteractions every interaction resolved to api / controller / stub / unresolved; resolveAction for one
//   contractMatcher     what the contract's example data says about a text
//   specOfFolder        a folder's API contract (openapi.json|yaml|yml) as the spec the resolvers take, no feature.json needed
import { loadContract } from "../contract.mjs";

export { buildInventory } from "./inventory.mjs";
export { collapse } from "./collapse.mjs";
export { classify } from "./classify.mjs";
export { resolveInteractions, resolveAction, usableSpec, interactionCoverage, handlerStub } from "./interactions.mjs";
export { contractMatcher } from "./contract-match.mjs";
export { findEndpoints, ACTION_KINDS } from "../match.mjs";
export { CONTRACT_FILES } from "../contract.mjs";

/**
 * A folder's API contract as the spec Trace's resolvers take (`{apis, list, contract}`). Unlike readSpec it needs no
 * feature.json: a Line feature keeps only its openapi file beside spec.md.
 *
 * @param {string} dir The folder that holds openapi.json, openapi.yaml or openapi.yml.
 * @returns {{apis: object[], list: string|null, contract: ReturnType<typeof loadContract>}}
 */
export function specOfFolder(dir) {
  const contract = loadContract(dir);
  return { apis: contract.apis, list: contract.listKey, contract };
}
