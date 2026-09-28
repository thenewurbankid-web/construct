// #443 slice 4b-iii — fetchSourceMapsForSelection against a real local HTTP server (no mocked fetch): a
// sibling `.map` file, an inline `data:` map, a missing map, no sourceMappingURL comment at all, and
// containment (a frame naming a different origin is never fetched, even though the stack said so).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchSourceMapsForSelection } from './previewSourceMaps.mjs';

const MAP = { version: 3, sources: ['../src/App.tsx'], names: [], mappings: 'AAAA' };
const INLINE_MAP_B64 = Buffer.from(JSON.stringify(MAP)).toString('base64');

const ROUTES = {
  '/app.js': { type: 'text/javascript', body: 'console.log(1);\n//# sourceMappingURL=app.js.map' },
  '/app.js.map': { type: 'application/json', body: JSON.stringify(MAP) },
  '/inline.js': { type: 'text/javascript', body: `console.log(1);\n//# sourceMappingURL=data:application/json;base64,${INLINE_MAP_B64}` },
  '/broken.js': { type: 'text/javascript', body: 'console.log(1);\n//# sourceMappingURL=missing.js.map' },
  '/nomap.js': { type: 'text/javascript', body: 'console.log(1);' },
};

let server;
let origin;

before(async () => {
  server = http.createServer((req, res) => {
    const route = ROUTES[req.url];
    if (!route) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': route.type }).end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const frame = (url) => `    at Foo (${url}:1:1)`;

test('fetches a sibling .map file named by a //# sourceMappingURL comment', async () => {
  const stack = `Error\n${frame(`${origin}/app.js`)}`;
  const found = await fetchSourceMapsForSelection({ stack }, { origin });
  assert.deepEqual(found, { [`${origin}/app.js`]: { map: MAP, url: `${origin}/app.js.map` } });
});

test('decodes an inline data: sourceMappingURL without a network round trip for the map itself', async () => {
  const stack = `Error\n${frame(`${origin}/inline.js`)}`;
  const found = await fetchSourceMapsForSelection({ stack }, { origin });
  assert.deepEqual(found, { [`${origin}/inline.js`]: { map: MAP, url: `${origin}/inline.js` } });
});

test('a missing map, no sourceMappingURL comment, and a foreign origin all resolve to nothing, never a throw', async () => {
  const stack = [
    'Error',
    frame(`${origin}/broken.js`),
    frame(`${origin}/nomap.js`),
    frame('http://evil.example/x.js'),
  ].join('\n');
  const found = await fetchSourceMapsForSelection({ stack }, { origin });
  assert.deepEqual(found, {}, 'nothing fetchable, but no crash and no cross-origin request');
});

test('accepts the payload wrapped as `{ selection }`, same as the bridge\'s own message shape', async () => {
  const stack = `Error\n${frame(`${origin}/app.js`)}`;
  const found = await fetchSourceMapsForSelection({ selection: { stack } }, { origin });
  assert.deepEqual(found, { [`${origin}/app.js`]: { map: MAP, url: `${origin}/app.js.map` } });
});

test('no stack, or no origin, resolves to nothing without fetching', async () => {
  assert.deepEqual(await fetchSourceMapsForSelection({}, { origin }), {});
  assert.deepEqual(await fetchSourceMapsForSelection({ stack: `Error\n${frame(`${origin}/app.js`)}` }, {}), {});
});
