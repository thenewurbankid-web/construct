```ts
export function addPick(id: string): void {
  const picks = JSON.parse(localStorage.getItem('picks')) || [];
  if (!picks.includes(id)) localStorage.setItem('picks', JSON.stringify([...picks, id]));
}
```