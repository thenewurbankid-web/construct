// #384 -- "a story file is not a permission" (design 9.6): the first use of any (host, url) named by a file needs
// an explicit standing decision before it is fetched again without asking. Persistence only; the HTTP surface and
// the "allow once is never persisted" rule live in `storyFetchApi.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { openConsentStore, consentFile, StoryConsentError } from '../packages/engine/storyConsentStore.mjs';

const PROJECT = '/work/acme-app';
const URL_A = 'https://github.com/acme/app/issues/1';

function store(stateDir = makeTempDir('story-consent-')) {
  let clock = 0;
  return { stateDir, consent: openConsentStore(PROJECT, { stateDir, now: () => `t${clock += 1}` }) };
}

test('no decision yet: decisionFor is null, nothing is on disk', () => {
  const { stateDir, consent } = store();
  assert.equal(consent.decisionFor('github.com', URL_A), null);
  assert.equal(fs.existsSync(consentFile(PROJECT, { stateDir })), false);
});

test('a url-scoped allow governs only that exact url, not the whole host', () => {
  const { consent } = store();
  consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'allow' });
  assert.equal(consent.decisionFor('github.com', URL_A)?.decision, 'allow');
  assert.equal(consent.decisionFor('github.com', 'https://github.com/acme/app/issues/2'), null);
});

test('"always for this host" governs every url on that host', () => {
  const { consent } = store();
  consent.record({ host: 'github.com', scope: 'host', decision: 'allow' });
  assert.equal(consent.decisionFor('github.com', URL_A)?.decision, 'allow');
  assert.equal(consent.decisionFor('github.com', 'https://github.com/acme/app/issues/999')?.decision, 'allow');
  assert.equal(consent.decisionFor('evil.example', URL_A), null);
});

test('an exact url decision wins over a host-level one', () => {
  const { consent } = store();
  consent.record({ host: 'github.com', scope: 'host', decision: 'allow' });
  consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'deny' });
  assert.equal(consent.decisionFor('github.com', URL_A)?.decision, 'deny');
  assert.equal(consent.decisionFor('github.com', 'https://github.com/acme/app/issues/2')?.decision, 'allow');
});

test('re-deciding the same (scope, host, url) replaces the old record, not duplicates it', () => {
  const { consent } = store();
  consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'deny' });
  consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'allow' });
  const matching = consent.list().filter((r) => r.host === 'github.com' && r.url === URL_A);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].decision, 'allow');
});

test('list() is newest first, and survives a fresh store instance over the same file (a restart)', () => {
  const { stateDir, consent } = store();
  consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'allow' });
  consent.record({ host: 'gitlab.com', scope: 'host', decision: 'deny' });
  const reopened = openConsentStore(PROJECT, { stateDir });
  const list = reopened.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].host, 'gitlab.com'); // recorded second -> newest first
});

test('revoke removes a standing decision by id; revoking an unknown id is a no-op (false)', () => {
  const { consent } = store();
  const rec = consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'allow' });
  assert.equal(consent.revoke('does-not-exist'), false);
  assert.equal(consent.revoke(rec.id), true);
  assert.equal(consent.decisionFor('github.com', URL_A), null);
  assert.equal(consent.list().length, 0);
});

test('a foreign-origin story is recorded, so the standing list can still show the extra warning', () => {
  const { consent } = store();
  const rec = consent.record({ host: 'github.com', url: URL_A, scope: 'url', decision: 'allow', sourceOrigin: 'foreign' });
  assert.equal(rec.sourceOrigin, 'foreign');
});

test('invalid input is rejected before anything is written: bad scope, url on a host-scoped record, bad decision, missing host/url', () => {
  const { stateDir, consent } = store();
  assert.throws(() => consent.record({ host: 'github.com', scope: 'repo', decision: 'allow' }), StoryConsentError);
  assert.throws(() => consent.record({ host: 'github.com', scope: 'host', url: URL_A, decision: 'allow' }), StoryConsentError);
  assert.throws(() => consent.record({ host: 'github.com', scope: 'url', decision: 'maybe' }), StoryConsentError);
  assert.throws(() => consent.record({ scope: 'host', decision: 'allow' }), StoryConsentError);
  assert.throws(() => consent.record({ host: 'github.com', scope: 'url', decision: 'allow' }), StoryConsentError);
  assert.equal(fs.existsSync(consentFile(PROJECT, { stateDir })), false);
});
