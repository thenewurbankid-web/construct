```typescript
export function removePick(id: string): void {
  const picks = listPicks();
  if (picks.includes(id)) localStorage.setItem('picks', JSON.stringify(picks.filter(bookId => bookId !== id)));
}
```