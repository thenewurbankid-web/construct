// im3 + j5 (pure): the open project's memory per step as Settings shows it.
import type { MemoryRow, MemoryView } from '../types';

/**
 * One row per memory step: its label, its size in words, and whether Forget has anything to clear.
 * @param view The server's memory view, or null while loading.
 */
export function memoryRows(view: MemoryView | null): MemoryRow[] {
  if (!view) return [];
  return view.steps.map((s) => ({
    step: s.step,
    label: s.label,
    size: s.size,
    sizeText: s.size === 1 ? '1 remembered decision' : `${s.size} remembered decisions`,
    canForget: s.size > 0,
  }));
}
