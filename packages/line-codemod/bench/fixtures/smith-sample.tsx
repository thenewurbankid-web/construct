// In-repo Smith fixture: hand-written TS/TSX covering the shapes the corpus
// golden test measures, so the golden check runs even without a Construct
// checkout. Not executed -- only parsed.
import type { ReactNode } from 'react';

type Item = { id: string; name: string; price?: number; tags: string[] };

export function totalPrice(items: Item[], { discount = 0, currency: code }: { discount?: number; currency: string }): string {
  let sum = 0;
  for (const { price } of items) {
    sum += price ?? 0;
  }
  const net = discount > 0 ? sum * (1 - discount) : sum;
  return `${net.toFixed(2)} ${code}`;
}

export const byTag = (items: Item[], tag: string) => items.filter((i) => i.tags.includes(tag));

export async function loadAll(ids: string[], fetchOne: (id: string) => Promise<Item | null>) {
  const out: Item[] = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      const item = await fetchOne(ids[i]);
      if (!item) continue;
      out.push({ ...item, name: item.name.trim() });
    } catch (err) {
      throw new Error(`failed on ${ids[i]}: ${(err as Error).message}`);
    }
  }
  return out;
}

export function reducer(state: { count: number; last?: string }, action: { type: string; by?: number }) {
  switch (action.type) {
    case 'inc':
    case 'add':
      return { ...state, count: state.count + (action.by ?? 1), last: action.type };
    case 'reset':
      return { count: 0 };
    default:
      return state;
  }
}

export class Cart {
  #items = new Map<string, Item>();

  add(item: Item): void {
    this.#items.set(item.id, item);
  }

  get size() {
    return this.#items.size;
  }

  find(id: string) {
    return this.#items.get(id)?.name;
  }
}

export function PriceTag({ item, onBuy, children }: { item: Item; onBuy?: () => void; children?: ReactNode }) {
  if (!item.price) return null;
  return (
    <div className="price-tag" data-id={item.id}>
      <span>{item.name}</span>
      {item.tags.length > 0 && <ul>{item.tags.map((t) => <li key={t}>{t}</li>)}</ul>}
      <button type="button" disabled={!onBuy} onClick={() => onBuy?.()}>
        Buy for {item.price}
      </button>
      {children}
    </div>
  );
}

export default function List({ items }: { items: Item[] }) {
  return <>{items.length ? items.map((i) => <PriceTag key={i.id} item={i} />) : <p>Nothing here</p>}</>;
}
