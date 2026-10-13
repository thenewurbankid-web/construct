// Picks store: the member's picked book ids, kept in localStorage under the key "picks".
const KEY = 'picks';

export function listPicks(): string[] {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function addPick(id: string): void {
  const picks = listPicks();
  if (!picks.includes(id)) localStorage.setItem(KEY, JSON.stringify([...picks, id]));
}

export function removePick(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listPicks().filter((p) => p !== id)));
}
