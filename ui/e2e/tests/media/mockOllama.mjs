// A stand-in for a local Ollama, used ONLY by the recording, and said so on screen. It speaks the one endpoint the core
// uses (POST /api/generate) and answers with a fixed, hand-written implementation per layer, so a re-record gives the
// same video. It binds Ollama's real port, which the core's ollama provider is fixed to, only if nothing else is there.
import http from 'node:http';

const FILES = {
  domain: `// Pure wishlist rules: no I/O, no framework.
export type WishlistItem = { id: number; name: string };
export type WishlistState = { items: WishlistItem[]; nextId: number };

export const emptyWishlist: WishlistState = { items: [], nextId: 1 };

export function Wishlist(state: WishlistState, name: string): WishlistState {
  const clean = name.trim();
  if (!clean || state.items.some((item) => item.name === clean)) return state;
  return { items: [...state.items, { id: state.nextId, name: clean }], nextId: state.nextId + 1 };
}

export function removeItem(state: WishlistState, id: number): WishlistState {
  return { ...state, items: state.items.filter((item) => item.id !== id) };
}
`,
  component: `type Item = { id: number; name: string };

export function Wishlist({ items, onAdd, onRemove }: { items: Item[]; onAdd: (name: string) => void; onRemove: (id: number) => void }) {
  return (
    <section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const field = form.elements.namedItem('name') as HTMLInputElement;
          onAdd(field.value);
          form.reset();
        }}
      >
        <input name="name" aria-label="Product name" placeholder="Product to save" />{' '}
        <button type="submit">Add</button>
      </form>
      {items.length === 0 ? (
        <p>Nothing saved yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {item.name}{' '}
              <button type="button" onClick={() => onRemove(item.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
`,
  page: `import type { ReactNode } from 'react';
import { Wishlist } from '../components/Wishlist';

type Item = { id: number; name: string };

export function WishlistPage({ items, onAdd, onRemove }: { items: Item[]; onAdd: (name: string) => void; onRemove: (id: number) => void }): ReactNode {
  return (
    <main>
      <h1>Your wishlist</h1>
      <Wishlist items={items} onAdd={onAdd} onRemove={onRemove} />
    </main>
  );
}
`,
  controller: `'use client';

import { useState } from 'react';
import { WishlistPage } from '../pages/WishlistPage';
import { Wishlist, emptyWishlist, removeItem } from '../domain/Wishlist';

export function WishlistController() {
  const [state, setState] = useState(emptyWishlist);
  return (
    <WishlistPage
      items={state.items}
      onAdd={(name) => setState(Wishlist(state, name))}
      onRemove={(id) => setState(removeItem(state, id))}
    />
  );
}
`,
};

const layerOf = (prompt) => /\(layer: "([a-z]+)"/.exec(prompt)?.[1];

export function startMockOllama(port = 11434) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'stand-in' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
      const prompt = JSON.parse(body || '{}').prompt || '';
      const layer = layerOf(prompt);
      calls.push(layer);
      setTimeout(() => res.end(JSON.stringify({ response: FILES[layer] ?? '' })), 1500);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ calls, close: () => new Promise((r) => server.close(r)) }));
  });
}
