// Picks store (reference copy, given as read-only context to tasks that use it).
// The member's picked book ids, kept in localStorage under the key "picks".
const KEY = 'picks';

export function listPicks(): string[] {
  const raw = globalThis.localStorage?.getItem(KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function addPick(id: string): void {
  const picks = listPicks();
  if (picks.includes(id)) return;
  globalThis.localStorage?.setItem(KEY, JSON.stringify([...picks, id]));
}

export function removePick(id: string): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(listPicks().filter((p) => p !== id)));
}
