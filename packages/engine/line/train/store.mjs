// Train Line store: Line's own state under `train/` of the training root (default: the Construct repo's `line/`
// folder, so the cases live at line/train/). Every change goes through Construct's transactional writer
// (createTransaction().commit()), all-or-nothing, like workspace.json; Line's own state needs no per-file approval, but
// every change appends one line to train/log.jsonl saying who made it (owner or claude) in the same commit.
//
//   train/cases.jsonl   one stored case per line (delexicalized)
//   train/log.jsonl     {at, by, action, caseId?, note?} per change
//   train/eval.json     the last eval run (scoreboard numbers)
//   train/maps/<world>.json  that world's confirmed synonyms {word: ref} (the domain map's owner part)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransaction } from '../../transactionalWriter.mjs';
import { LineOpError } from '../contract.mjs';
import { TRAIN_INTENT_MAP } from './contract.mjs';

/** The Construct repo's `line/` folder: the default training root (its train/cases.jsonl is the committed seed). */
export const DEFAULT_TRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../line');
export const CASES = 'train/cases.jsonl';
export const LOG = 'train/log.jsonl';
export const EVAL = 'train/eval.json';
/**
 * Where a world's confirmed synonyms are kept.
 * @param {string} worldKey
 * @returns {string}
 */
export const mapFile = (worldKey) => `train/maps/${worldKey.replace(/[^a-z0-9-]/gi, '_')}.json`;

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const lines = (text) => (text ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
/** A case stored before 2026-10-11 names a mirrored intent id; read it with the drafter catalog's id. */
const upgrade = (c) => (c && Object.hasOwn(TRAIN_INTENT_MAP, c.intent) && TRAIN_INTENT_MAP[c.intent] !== c.intent ? { ...c, intent: TRAIN_INTENT_MAP[c.intent] } : c);

/**
 * The Train Line store over one training root.
 * @param {{root?: string, seedFrom?: string, now?: () => string}} [o] `seedFrom`: a training root whose cases seed an
 *   empty store on first open (the committed seed), logged as Claude's proposals.
 * @returns {any}
 */
export function createTrainStore(o = {}) {
  const root = o.root ?? DEFAULT_TRAIN_ROOT;
  const now = o.now ?? (() => new Date().toISOString());
  fs.mkdirSync(root, { recursive: true });

  /** Write files (and log lines) in one commit through Construct's writer. */
  function commit(files, logLines) {
    const txn = createTransaction(root);
    for (const [rel, content] of Object.entries(files)) txn.writeFile(rel, content);
    if (logLines.length) txn.writeFile(LOG, `${read(root, LOG) ?? ''}${logLines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    let r;
    try { r = txn.commit({ validate: () => ({ violations: [], ok: true }) }); } catch { txn.reset(); r = { committed: false }; }
    if (!r.committed) throw new LineOpError('The training cases could not be saved; nothing was changed.', 'WRITE_FAILED');
  }

  function seedIfEmpty() {
    if (read(root, CASES) !== null || !o.seedFrom || path.resolve(o.seedFrom) === path.resolve(root)) return;
    const seed = read(o.seedFrom, CASES);
    if (seed === null) return;
    commit({ [CASES]: seed }, [{ at: now(), by: 'claude', action: 'seed', note: `${lines(seed).length} proposed cases` }]);
  }
  seedIfEmpty();

  const store = {
    root,
    /** Every stored case. */
    all: () => lines(read(root, CASES)).map(upgrade),
    /** @param {string} id */
    get: (id) => store.all().find((c) => c.id === id) ?? null,
    /** The change log, newest last. */
    log: () => lines(read(root, LOG)),
    /**
     * Add cases (new ids) or replace cases (same id), logged as one action each by `by`.
     * @param {any[]} cases @param {'owner'|'claude'} by @param {string} action @param {string} [note]
     */
    put(cases, by, action, note) {
      const list = store.all();
      const at = now();
      for (const c of cases) {
        const i = list.findIndex((x) => x.id === c.id);
        if (i >= 0) list[i] = c; else list.push(c);
      }
      commit({ [CASES]: list.map((c) => JSON.stringify(c)).join('\n') + (list.length ? '\n' : '') }, cases.map((c) => ({ at, by, action, caseId: c.id, ...(note ? { note } : {}) })));
    },
    /**
     * Replace every stored case at once (a re-verification or a migration), logged as ONE action by `by`.
     * @param {any[]} cases @param {'owner'|'claude'} by @param {string} action @param {string} [note]
     */
    rewrite(cases, by, action, note) {
      commit({ [CASES]: cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : '') }, [{ at: now(), by, action, ...(note ? { note } : {}) }]);
    },
    /** The last eval run, or null. */
    lastEval: () => { const t = read(root, EVAL); return t ? JSON.parse(t) : null; },
    saveEval(result, by) { commit({ [EVAL]: `${JSON.stringify(result, null, 2)}\n` }, [{ at: now(), by, action: 'eval' }]); },
    /** A world's confirmed synonyms {word: ref}. */
    synonyms: (worldKey) => { const t = read(root, mapFile(worldKey)); return t ? JSON.parse(t) : {}; },
    addSynonym(worldKey, word, ref, by) {
      const map = { ...store.synonyms(worldKey), [String(word).toLowerCase()]: ref };
      commit({ [mapFile(worldKey)]: `${JSON.stringify(map, null, 2)}\n` }, [{ at: now(), by, action: 'synonym', note: ref }]);
      return map;
    },
  };
  return store;
}
