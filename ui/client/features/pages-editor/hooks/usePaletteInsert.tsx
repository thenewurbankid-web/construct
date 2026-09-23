'use client';

import { useState } from 'react';
import { insertPaletteEntry } from '../services/PaletteApi';
import type { PageTree, PaletteChipKind, PaletteEntry, StatusMessage } from '../types';

const keyOf = (kind: PaletteChipKind, entry: PaletteEntry) => `${kind}:${entry.path}:${entry.name}`;

/** #532 (Slice 2 of #518's design) -- click a Component/Provider Palette entry (#527) to insert its
 * real import + usage at the end of the currently open page. Tracks which single entry (if any) is
 * mid-insert, so only that row shows a busy state, and the last insert's outcome for the panel's own
 * status line. */
export function usePaletteInsert(feature: string, file: string, contentHash: string, onInserted: (tree: PageTree) => void) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function insert(kind: PaletteChipKind, entry: PaletteEntry) {
    const key = keyOf(kind, entry);
    setPendingKey(key);
    setStatus(null);
    const result = await insertPaletteEntry({ feature, file, kind: kind as 'provider' | 'component', name: entry.name, path: entry.path, contentHash });
    setPendingKey((current) => (current === key ? null : current));
    if (result.ok) {
      setStatus({ ok: true, message: `Inserted ${entry.name}.` });
      onInserted(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Could not insert.', violations: result.violations });
    }
  }

  return { insert, isPending: (kind: PaletteChipKind, entry: PaletteEntry) => pendingKey === keyOf(kind, entry), status };
}
