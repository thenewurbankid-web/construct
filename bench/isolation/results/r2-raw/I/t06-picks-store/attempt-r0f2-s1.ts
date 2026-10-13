// Picks store: the member's picked book ids, kept in localStorage under the key "picks".

export function listPicks(): string[] {
  const raw = localStorage.getItem('picks');
  return raw ? JSON.parse(raw) as string[] : [];
}

export function addPick(id: string): void {
  const picks = JSON.parse(localStorage.getItem('picks')) || [];
  if (!picks.includes(id)) localStorage.setItem('picks', JSON.stringify([...picks, id]));
}
