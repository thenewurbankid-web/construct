```ts
export function listPicks(): string[] {
  const raw = localStorage.getItem('picks');
  return raw ? (JSON.parse(raw) as string[]) : [];
}
```