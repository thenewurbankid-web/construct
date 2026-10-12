// "What Line knows", Memory tab's server side (contract.mjs MemoryRecordsView), on im3's real store (memory/store.mjs:
// <state>/memory/<step>.jsonl). Beside im3's GET /memory and POST /memory/forget: the records, edit one, forget one, a
// step or all, export, import, and the per-project embeddings switch. A person does each of these (the routes check it,
// ui/server/src/lineMemoryApi.mjs); every change is logged. Everything is Line's own state, written only through
// Construct's writer (writeLineState):
//   <state>/memory.log.jsonl        one MemoryLogEntry per change (who, what, which record or step; never its text)
//   <state>/memory.settings.json    {v: 1, embeddings: boolean}, off by default; LINE_MEMORY_EMBED overrides it
// Nothing here opens a connection: memory never leaves the machine.
import fs from 'node:fs';
import path from 'node:path';
import { writeLineState } from '../../transactionalWriter.mjs';
import { memoryOf } from '../memory/index.mjs';
import { embeddingsEnabled } from '../memory/embed.mjs';
import { STEP_ID } from '../memory/contract.mjs';

/** @typedef {import('../memory/contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {import('../memory/contract.mjs').MemoryExport} MemoryExport */
/** @typedef {import('./contract.mjs').MemoryRecordsView} MemoryRecordsView */
/** @typedef {import('./contract.mjs').MemoryLogEntry} MemoryLogEntry */
/** @typedef {import('./contract.mjs').MemoryAction} MemoryAction */
/** @typedef {{ok: false, code: string, sentence: string}} MemoryRefusal */

export const MEMORY_LOG_FILE = 'memory.log.jsonl';
export const MEMORY_SETTINGS_FILE = 'memory.settings.json';
/** How many of the newest log entries a view carries. */
export const LOG_SHOWN = 50;
const ID = /^m-[a-z0-9]{6,32}$/;

const refuse = (code, sentence) => /** @type {MemoryRefusal} */ ({ ok: false, code, sentence });
const decisions = (n) => `${n} decision${n === 1 ? '' : 's'}`;

/**
 * The Memory tab's service of one project.
 * @param {string} root
 * @param {{memory?: import('../memory/store.mjs').LineMemory, env?: Record<string, string|undefined>, now?: () => string}} [o]
 *   `memory`: the project's store (default im3's memoryOf(root)); `env`: for LINE_MEMORY_EMBED (default process.env).
 * @returns The service: embeddingsOn, records, edit, forgetRecord, forgetStep, forgetAll, exportMemory, importMemory, setEmbeddings.
 */
export function createMemoryService(root, o = {}) {
  const memory = o.memory ?? memoryOf(root);
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date().toISOString());
  const stateDir = memory.stateDir;
  const abs = (f) => path.join(root, stateDir, f);
  const readText = (f) => { try { return fs.readFileSync(abs(f), 'utf8'); } catch { return null; } };

  /** @returns {MemoryLogEntry[]} */
  function log() {
    const text = readText(MEMORY_LOG_FILE) ?? '';
    return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.by === 'person' && typeof e.action === 'string' && typeof e.target === 'string' && typeof e.at === 'string');
  }
  /** @param {MemoryAction} action @param {string} target */
  const logged = (action, target) => {
    /** @type {MemoryLogEntry} */
    const e = { at: now(), by: 'person', action, target };
    writeLineState(root, `${stateDir}/${MEMORY_LOG_FILE}`, `${JSON.stringify(e)}\n`, { append: true, stateDir });
  };

  /** The project's stored switch (off when missing or unreadable). */
  const storedEmbeddings = () => { try { return JSON.parse(readText(MEMORY_SETTINGS_FILE) ?? '{}').embeddings === true; } catch { return false; } };
  /** Whether embeddings are on for this project (the stored switch; LINE_MEMORY_EMBED overrides it). */
  const embeddingsOn = () => embeddingsEnabled(env, storedEmbeddings());

  const steps = () => Object.keys(memory.sizes()).sort();
  /** @param {string} id @returns {MemoryRecord|null} */
  const find = (id) => { for (const s of steps()) { const r = memory.records(s).find((x) => x.id === id); if (r) return r; } return null; };

  /**
   * @param {string|null} [step]
   * @returns {MemoryRecordsView}
   */
  function view(step = null) {
    const records = (step === null ? steps() : [step]).flatMap((s) => memory.records(s));
    const sentence = records.length
      ? `Line remembers ${decisions(records.length)} ${step === null ? 'for this project' : 'for this step'}, on this computer only.`
      : 'Line remembers nothing here yet; it learns from what you pick, approve and change.';
    return { ok: true, step, records, embeddings: { on: embeddingsOn(), covers: 'slotted-text' }, log: log().slice(-LOG_SHOWN), sentence };
  }

  return {
    embeddingsOn,
    /** @param {{step?: unknown}} [a] */
    records(a = {}) {
      if (a.step === undefined || a.step === null || a.step === '') return view(null);
      if (typeof a.step !== 'string' || !STEP_ID.test(a.step)) return refuse('BAD_ARGS', 'Name an AI step, for example drafter.route.');
      return view(a.step);
    },
    /** A person corrects one record: `chosen` must be one of the options Line offered for it. @param {{id?: unknown, chosen?: unknown}} a */
    edit(a) {
      if (typeof a?.id !== 'string' || !ID.test(a.id)) return refuse('BAD_ARGS', 'Name the decision to change.');
      const r = find(a.id);
      if (!r) return refuse('UNKNOWN_RECORD', 'Line does not remember that decision.');
      if (typeof a.chosen !== 'string' || !r.options.includes(a.chosen)) return refuse('BAD_ARGS', 'Pick one of the options Line offered for that decision.');
      const chosen = a.chosen;
      memory.update(r.step, r.id, (x) => ({ ...x, chosen, kind: 'edited', by: 'person', agreed: chosen === x.proposed }));
      logged('edit', r.id);
      return view();
    },
    /** @param {{id?: unknown}} a */
    forgetRecord(a) {
      if (typeof a?.id !== 'string' || !ID.test(a.id)) return refuse('BAD_ARGS', 'Name the decision to forget.');
      const r = find(a.id);
      if (!r || !memory.remove(r.step, r.id)) return refuse('UNKNOWN_RECORD', 'Line does not remember that decision.');
      logged('forget', r.id);
      return view();
    },
    /** im3's forget-a-step, logged. @param {{step?: unknown}} a */
    forgetStep(a) {
      if (typeof a?.step !== 'string' || !STEP_ID.test(a.step)) return refuse('BAD_ARGS', 'Name the step whose memory to forget.');
      const out = memory.forget(a.step);
      logged('forgetStep', a.step);
      return { ...view(), removed: out.removed };
    },
    forgetAll() {
      for (const s of steps()) memory.forget(s);
      logged('forgetAll', 'all');
      return view();
    },
    /** @returns {MemoryExport} */
    exportMemory() {
      return memory.exportAll();
    },
    /** A person imports an exported file (each record passes the shape check and this project's leak guard). @param {unknown} file */
    async importMemory(file) {
      let out;
      try { out = await memory.importAll(file); } catch (e) {
        const err = /** @type {any} */ (e);
        if (err?.name === 'LineOpError') return refuse(err.code, err.sentence);
        throw e;
      }
      logged('import', `${out.added} records`);
      const v = view();
      return { ...v, sentence: `Imported ${decisions(out.added)}${out.skipped ? `; ${out.skipped} ${out.skipped === 1 ? 'was' : 'were'} already here` : ''}. ${v.sentence}` };
    },
    /** @param {{on?: unknown}} a */
    setEmbeddings(a) {
      if (typeof a?.on !== 'boolean') return refuse('BAD_ARGS', 'Say on or off.');
      writeLineState(root, `${stateDir}/${MEMORY_SETTINGS_FILE}`, `${JSON.stringify({ v: 1, embeddings: a.on })}\n`, { stateDir });
      logged('embeddings', a.on ? 'on' : 'off');
      return view();
    },
  };
}

/** @typedef {ReturnType<typeof createMemoryService>} MemoryService */

/** @type {Map<string, MemoryService>} */
const byRoot = new Map();

/**
 * The Memory tab's service of the project at `root` (one per root).
 * @param {string} root
 * @returns {MemoryService}
 */
export function memoryServiceFor(root) {
  if (!byRoot.has(root)) byRoot.set(root, createMemoryService(root));
  return /** @type {MemoryService} */ (byRoot.get(root));
}
