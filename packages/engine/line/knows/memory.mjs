// "What Line knows", Memory tab's server side (owned by the Memory tab's branch, cloud-knows-memory). Until it is wired to
// im3's store (memory/index.mjs memoryOf), a project's memory page reads the contract's mock, one per root, in memory.
import { createMockKnows } from './mock.mjs';

/** @type {Map<string, ReturnType<typeof createMockKnows>>} */
const byRoot = new Map();

/**
 * The memory page's service of one project (beside im3's GET /memory and POST /memory/forget): records, edit, forget one or all, export, import and the embeddings switch (person only; every
 * change is logged in the view's log).
 * @param {string} root
 * @returns {{records: Function, edit: Function, forgetRecord: Function, forgetAll: Function, exportMemory: Function, importMemory: Function, setEmbeddings: Function}}
 */
export function memoryServiceFor(root) {
  if (!byRoot.has(root)) byRoot.set(root, createMockKnows());
  const m = /** @type {ReturnType<typeof createMockKnows>} */ (byRoot.get(root));
  return { records: m.records, edit: m.edit, forgetRecord: m.forgetRecord, forgetAll: m.forgetAll, exportMemory: m.exportMemory, importMemory: m.importMemory, setEmbeddings: m.setEmbeddings };
}
