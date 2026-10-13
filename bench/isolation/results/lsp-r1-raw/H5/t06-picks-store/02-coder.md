```typescript
export function addPick(id: string): void {
  const picks = listPicks();
  if (!picks.includes(id)) localStorage.setItem('picks', JSON.stringify([...picks, id]));
}
```