// "What Line knows", Memory tab: read what Line remembered, and each person's action on it (edit, forget one, a step or
// all, export, import, the embeddings switch), each answered as {view, sentence, message}. The server checks it is a
// person and logs the change; a refusal keeps the view and says why in its own sentence.
import type { KnowsHttp, MemoryRecordsView } from '@/lib/lineKnowsContract';
import { exportFileName, optionWords, parseMemoryFile, stepLabel } from '../domain/MemoryTab.ts';

export type MemoryHttp = Pick<
  KnowsHttp,
  'memoryRecords' | 'memoryEdit' | 'memoryForgetStep' | 'memoryForgetRecord' | 'memoryForgetAll' | 'memoryExport' | 'memoryImport' | 'memoryEmbeddings'
>;

export type MemoryTabAction =
  | { kind: 'edit'; id: string; chosen: string }
  | { kind: 'forgetRecord'; id: string }
  | { kind: 'forgetStep'; step: string }
  | { kind: 'forgetAll' }
  | { kind: 'export' }
  | { kind: 'import'; text: string }
  | { kind: 'embeddings'; on: boolean };

/** `file`: the export to save, after an export. */
export type MemoryTabAnswer = { view: MemoryRecordsView | null; sentence: string; message: string | null; file?: { name: string; text: string } };

const UNREADABLE = 'What Line remembered could not be read; Line ranks by its static order meanwhile.';
const FAILED = 'Line could not do that; nothing was changed.';

type Answer = { ok?: unknown; sentence?: unknown } | null | undefined;
const refusalOf = (r: Answer): string | null => {
  if (r && r.ok === true) return null;
  return r && typeof r.sentence === 'string' ? r.sentence : FAILED;
};

/** Reads the records view; a refusal keeps its own sentence. */
export async function loadMemoryTab(http: Pick<MemoryHttp, 'memoryRecords'>): Promise<MemoryTabAnswer> {
  try {
    const r = await http.memoryRecords();
    if (r && r.ok === true) return { view: r, sentence: r.sentence, message: null };
    return { view: null, sentence: refusalOf(r) ?? UNREADABLE, message: null };
  } catch {
    return { view: null, sentence: UNREADABLE, message: null };
  }
}

const EMBEDDINGS_ON = 'Embeddings are on: Line also compares the slotted decision text with a local model, never code.';
const EMBEDDINGS_OFF = 'Embeddings are off: Line compares decisions by their slots and structure only.';

/** One action; the answer carries the new view and what was done (or the refusal's sentence, with the view kept). */
export async function runMemoryAction(http: MemoryHttp, action: MemoryTabAction, before: MemoryTabAnswer): Promise<MemoryTabAnswer> {
  try {
    if (action.kind === 'export') {
      const r = await http.memoryExport();
      if (!r || !('kind' in r)) return { ...before, message: refusalOf(r as Answer) ?? FAILED };
      return { ...before, message: 'Exported what Line remembered; keep the file to import it later.', file: { name: exportFileName(new Date()), text: `${JSON.stringify(r, null, 2)}\n` } };
    }
    if (action.kind === 'forgetStep') {
      const r = await http.memoryForgetStep(action.step);
      const no = refusalOf(r);
      if (no) return { ...before, message: no };
      const next = await loadMemoryTab(http);
      return { ...next, message: `Line forgot everything for '${stepLabel(action.step)}'.` };
    }
    if (action.kind === 'import') {
      const parsed = parseMemoryFile(action.text);
      if (!parsed.ok) return { ...before, message: parsed.sentence };
      const r = await http.memoryImport(parsed.file);
      const no = refusalOf(r);
      if (no || !r.ok) return { ...before, message: no ?? FAILED };
      return { view: r, sentence: r.sentence, message: r.sentence.startsWith('Imported') ? r.sentence : `Imported the file. ${r.sentence}` };
    }
    const call = {
      edit: () => http.memoryEdit((action as { id: string }).id, (action as { chosen: string }).chosen),
      forgetRecord: () => http.memoryForgetRecord((action as { id: string }).id),
      forgetAll: () => http.memoryForgetAll(),
      embeddings: () => http.memoryEmbeddings((action as { on: boolean }).on),
    }[action.kind];
    const r = await call();
    const no = refusalOf(r);
    if (no || !r.ok) return { ...before, message: no ?? FAILED };
    const said = {
      edit: () => `Saved: Line now remembers '${optionWords((action as { chosen: string }).chosen)}' for that decision.`,
      forgetRecord: () => 'Line forgot that decision.',
      forgetAll: () => 'Line forgot everything it remembered for this project.',
      embeddings: () => ((action as { on: boolean }).on ? EMBEDDINGS_ON : EMBEDDINGS_OFF),
    }[action.kind];
    return { view: r, sentence: r.sentence, message: said() };
  } catch {
    return { ...before, message: FAILED };
  }
}
