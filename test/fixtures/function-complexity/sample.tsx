// #923 fixture: one function per counting rule; expected values (ESLint complexity) in test/ast-function-complexity.test.mjs.
declare function done(): void;

export function flat(a: number) { return a + 1; }

export function oneIf(a: boolean) { if (a) { return 1; } return 0; }

export function ifElseChain(n: number) {
  if (n < 0) { return -1; } else if (n === 0) { return 0; } else { return 1; }
}

export function loops(xs: number[]) {
  let s = 0;
  for (const x of xs) { if (x > 0) { s += x; } }
  while (s > 100) { s -= 1; }
  return s;
}

export function sw(k: string) {
  switch (k) { case 'a': return 1; case 'b': return 2; default: return 0; }
}

export function logic(a: boolean, b: boolean, c: boolean, d: boolean) { return a && b && c || d; }

export function mixed(a: boolean, b: boolean, c: boolean) { if (a && (b || c)) { return true; } return false; }

export function tryCatch(f: () => unknown) {
  try { return f(); } catch (e) { if (e) { throw e; } return null; } finally { done(); }
}

export const ternary = (a: boolean, b: boolean) => (a ? (b ? 1 : 2) : 3);

export function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }

export function labeled(grid: boolean[][]) {
  outer: for (const row of grid) { for (const c of row) { if (c) { continue outer; } } }
}

export const nullish = (a?: number, b?: { c?: number }) => a ?? b?.c ?? 0;

export function assign(o: { a?: number; b?: number; c?: number }) { o.a ||= 1; o.b &&= 2; o.c ??= 3; return o; }

export function Card({ item, onPick }: { item: { id: string; enabled: boolean; title?: string; tags: string[] }; onPick?: (id: string) => void }) {
  const handleClick = () => { if (item.enabled && onPick) { onPick(item.id); } };
  return <div onClick={handleClick}>{item.title ? <b>{item.title}</b> : null}{item.tags.map((t) => <i key={t}>{t}</i>)}</div>;
}

export class Repo {
  items: { id: number }[] = [];
  find(id: number): { id: number } | undefined {
    for (let i = 0; i < this.items.length; i++) { if (this.items[i].id === id) return this.items[i]; }
    return this.find(id - 1);
  }
}

export function deep(o: Record<string, number>, x: number) {
  if (x) { return 0; } else { for (const k in o) { do { x--; } while (x > 0); } }
  return x;
}
