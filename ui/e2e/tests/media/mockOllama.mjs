// A stand-in for a local Ollama, used ONLY by the recording, and said so on screen. It speaks the one endpoint the core
// uses (POST /api/generate) and answers with a fixed, hand-written implementation per layer, so a re-record gives the
// same video. It binds Ollama's real port, which the core's ollama provider is fixed to, only if nothing else is there.
import http from 'node:http';

const FILES = {
  domain: `// Pure wishlist rules: no I/O, no framework.
export type WishlistItem = { productId: string; addedAt: number };

export function Wishlist(items: WishlistItem[], productId: string, now: number): WishlistItem[] {
  if (items.some((item) => item.productId === productId)) return items.filter((item) => item.productId !== productId);
  return [...items, { productId, addedAt: now }];
}
`,
  component: `export function Wishlist({ names, onRemove }: { names: string[]; onRemove: (index: number) => void }) {
  return (
    <ul>
      {names.map((name, index) => (
        <li key={name}>
          {name} <button type="button" onClick={() => onRemove(index)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}
`,
  page: `import type { ReactNode } from 'react';

export function WishlistPage({ names, onRemove }: { names: string[]; onRemove: (index: number) => void }): ReactNode {
  return (
    <main>
      <h1>Your wishlist</h1>
      {names.length === 0 ? <p>Nothing saved yet.</p> : (
        <ul>
          {names.map((name, index) => (
            <li key={name}>
              {name} <button type="button" onClick={() => onRemove(index)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </main>
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
