import test from 'node:test';
import assert from 'node:assert/strict';
import { savePageProp } from './SavePropFlow.ts';

const part = { nodeId: 'n3', tag: 'Card', depth: 0, props: [] };
const fakeApi = (answer) => {
  const sent = [];
  return { sent, setPageProp: async (req) => { sent.push(req); if (answer instanceof Error) throw answer; return answer; } };
};

test('savePageProp: sends one SetPropRequest with the value as the prop kind, and shows the ApplyResult sentence', async () => {
  const api = fakeApi({ ok: true, sentence: 'Saved. Sets count to "4" on the page P.', files: ['p.tsx'], findings: [] });
  const out = await savePageProp(api, 'features/a/pages/P.tsx', part, { name: 'count', kind: 'number', value: 3 }, '4');
  assert.deepEqual(api.sent, [{ file: 'features/a/pages/P.tsx', nodeId: 'n3', prop: 'count', kind: 'number', value: 4 }]);
  assert.deepEqual(out, { ok: true, sentence: 'Saved. Sets count to "4" on the page P.', findings: [] });
});

test('savePageProp: a bad number is refused before anything is sent', async () => {
  const api = fakeApi({ ok: true, sentence: 'Saved.', files: [], findings: [] });
  const out = await savePageProp(api, 'f.tsx', part, { name: 'count', kind: 'number', value: 3 }, 'three');
  assert.equal(api.sent.length, 0);
  assert.equal(out.sentence, 'Nothing was saved: "three" is not a number, so type digits only.');
});

test('savePageProp: a server refusal (400 body) and a network failure both read "Nothing was saved: ..."', async () => {
  const refused = await savePageProp(fakeApi({ ok: false, sentence: 'That value is not allowed here.', code: 'BAD_VALUE' }), 'f.tsx', part, { name: 'title', kind: 'string', value: 'a' }, 'b');
  assert.deepEqual(refused, { ok: false, sentence: 'Nothing was saved: that value is not allowed here.', findings: [] });
  const down = await savePageProp(fakeApi(new TypeError('Failed to fetch')), 'f.tsx', part, { name: 'title', kind: 'string', value: 'a' }, 'b');
  assert.equal(down.ok, false);
  assert.match(down.sentence, /^Nothing was saved: the server did not answer/);
});
