'use client';

import { useCallback, useEffect, useState } from 'react';
import { createNote, listNotes, type NoteRow } from '@/features/notes';

export type NodeNotes = { ok: true; notes: NoteRow[] } | { ok: false; error: string };

/** Inspector "Notes" section (#832): notes anchored to the selected node, over the SAME /api/notes #373 already
 * exposes -- no new storage, no new route, only an `anchor` field (added to Note/NoteRow) and a client-side
 * filter, the same way the standalone Notes screen filters nothing (it shows every note) and this one shows
 * only the ones anchored here. */
export function useNodeNotes(feature: string, file: string, nodeId: string | null) {
  const [all, setAll] = useState<NodeNotes | null>(null);

  const reload = useCallback(() => {
    listNotes().then((r) => setAll(r.ok ? { ok: true, notes: r.data } : { ok: false, error: r.error }));
  }, []);

  useEffect(() => {
    setAll(null);
    reload();
  }, [feature, file, reload]);

  const notes: NodeNotes | null = all === null || !all.ok || nodeId === null
    ? all
    : { ok: true, notes: all.notes.filter((n) => n.anchor?.feature === feature && n.anchor?.file === file && n.anchor?.nodeId === nodeId) };

  const addNote = useCallback(
    async (title: string) => {
      if (nodeId === null) return;
      const r = await createNote({ title, body: '' }, { anchor: { feature, file, nodeId } });
      if (r.ok) reload();
      return r;
    },
    [feature, file, nodeId, reload],
  );

  return { notes, addNote };
}
