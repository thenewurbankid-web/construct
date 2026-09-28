import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gotoCockpit } from './support/cockpit.js';
import { openProject } from './support/browseProject.js';

// #386 (part of #367, design docs/design/ia-five-screens.md section 9.7) -- the userscript bridge and
// click-to-pick. `construct-clipper.user.js` is not a browser extension, so it cannot be loaded into
// Chromium as one; this spec injects its exact IIFE body via `page.addInitScript`, with small GM_* stubs
// standing in for the userscript manager (Tampermonkey/Violentmonkey provide these for real; here they are
// faked at that boundary, the same idea a browser extension gives for free). Everything below that
// boundary -- selector validation, the origin/nonce/approval/rate-limit guards, the picker -- is the real,
// unmodified script, exercised for real. The server half (`storyBridgeApi.mjs`, mounted at
// `/api/story-bridge`) runs for real against the real ui/server and a real throwaway git project.
const API = process.env.E2E_API_BASE || 'http://localhost:4000';
const SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public/construct-clipper.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

// A minimal fixture ticket page: stable ids/data-testid on the fields the Picker cares about, a decoy
// unlabelled paragraph to prove the picker's selector stays specific, and two acceptance bullets to prove
// the list field takes every match in document order (design 9.6b).
const TICKET_URL = 'https://acme.atlassian.net/browse/STORE-142';
const TICKET_HTML = `<!doctype html><html><body>
  <h1 data-testid="issue.title">Refund a delivered order</h1>
  <div id="issue-status">In Progress</div>
  <div class="description">Customer wants a refund after delivery.</div>
  <p>Unrelated marketing copy that nothing should pick.</p>
  <ul class="acceptance">
    <li>Refund appears within 2 days</li>
    <li>Order is marked refunded</li>
  </ul>
</body></html>`;

/** GM_* stand-ins, installed before the clipper script via addInitScript so they exist the instant it runs.
 * `GM_xmlhttpRequest` here answers with the fixture ticket page above (design's "Tested against a fixture
 * ticket page") -- a real GM_xmlhttpRequest reaches the real internet with the user's own cookies, which a
 * spec has no honest way to fake, so this is the one seam that is stubbed, exactly as the script's own
 * top-of-file comment documents. */
function gmStubsScript({ cockpitOrigin, ticketUrl, ticketHtml }) {
  return `
    window.__CONSTRUCT_CLIPPER_TEST__ = true;
    window.__CONSTRUCT_CLIPPER_COCKPIT_ORIGIN__ = ${JSON.stringify(cockpitOrigin)};
    window.__constructClipperGmStore = {};
    window.__constructClipperMenuCommands = [];
    window.__constructClipperAlerts = [];
    window.alert = (msg) => window.__constructClipperAlerts.push(msg);
    window.GM_getValue = (key, fallback) => (key in window.__constructClipperGmStore ? window.__constructClipperGmStore[key] : fallback);
    window.GM_setValue = (key, value) => { window.__constructClipperGmStore[key] = value; };
    window.GM_deleteValue = (key) => { delete window.__constructClipperGmStore[key]; };
    window.GM_listValues = () => Object.keys(window.__constructClipperGmStore);
    window.GM_addValueChangeListener = () => {};
    window.GM_registerMenuCommand = (label, fn) => { window.__constructClipperMenuCommands.push({ label, fn }); };
    window.GM_xmlhttpRequest = ({ url, onload, onerror }) => {
      if (url === ${JSON.stringify(ticketUrl)}) { onload({ status: 200, responseText: ${JSON.stringify(ticketHtml)} }); return; }
      onerror(new Error('unexpected fixture URL: ' + url));
    };
  `;
}

test.describe('Construct Clipper: userscript bridge and click-to-pick (#386)', () => {
  test('Bridge: refuses an unapproved host, a bad nonce and a foreign frame; once approved, returns only the picked fields, respects the rate limit and logs every attempt', async ({ page, baseURL }) => {
    const cockpitOrigin = baseURL;
    await page.addInitScript(gmStubsScript({ cockpitOrigin, ticketUrl: TICKET_URL, ticketHtml: TICKET_HTML }));
    await page.addInitScript(SCRIPT_SOURCE);
    await gotoCockpit(page, '/');

    // A well-formed request, host not yet approved: refused, and the refusal is logged.
    const unapproved = await page.evaluate(async ({ url }) => {
      const parse = { title: { xpath: "//h1[@data-testid='issue.title']" } };
      return window.__constructClipperCore.handleBridgeRequest({ requestId: '1', nonce: 'a'.repeat(16), url, parse });
    }, { url: TICKET_URL });
    expect(unapproved.ok).toBe(false);
    expect(unapproved.error).toMatch(/not approved/);

    // Approve the host (the userscript menu's "allow this Cockpit" command, exercised directly): now the
    // same request returns ONLY the picked fields -- no page text, no other DOM, nothing beyond what `parse`
    // named -- and the multi-match / list-field rules from design 9.6b hold.
    await page.evaluate(({ origin, host }) => window.__constructClipperCore.approveHost(origin, host), { origin: cockpitOrigin, host: 'acme.atlassian.net' });
    const approved = await page.evaluate(async ({ url }) => {
      const parse = {
        title: { xpath: "//h1[@data-testid='issue.title']" },
        status: '#issue-status',
        description: 'div.description',
        acceptance: 'ul.acceptance > li',
      };
      return window.__constructClipperCore.handleBridgeRequest({ requestId: '2', nonce: 'a'.repeat(16), url, parse });
    }, { url: TICKET_URL });
    expect(approved.ok).toBe(true);
    expect(approved.fields.title).toEqual({ ok: true, matchCount: 1, value: 'Refund a delivered order' });
    expect(approved.fields.status).toEqual({ ok: true, matchCount: 1, value: 'In Progress' });
    expect(approved.fields.acceptance.value).toEqual(['Refund appears within 2 days', 'Order is marked refunded']);
    expect(JSON.stringify(approved)).not.toContain('marketing copy');

    // Bad nonce and a foreign frame (event.source !== window, the XSS-in-page threat design 9.7 names): the
    // real postMessage listener installed by the script -- not the exposed test hook -- refuses both, and
    // never answers with page contents.
    const responses = await page.evaluate(({ origin, url }) => new Promise((resolve) => {
      const seen = [];
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'construct-clipper:response') seen.push(e.data);
      });
      window.postMessage({ type: 'construct-clipper:request', requestId: 'bad-nonce', nonce: 'short', url, parse: { title: 'h1' } }, origin);
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      iframe.contentWindow.postMessage({ type: 'construct-clipper:request', requestId: 'foreign-frame', nonce: 'a'.repeat(16), url, parse: { title: 'h1' } }, origin);
      // Same-window dispatch of a message whose event.origin claims to be some other page entirely.
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'construct-clipper:request', requestId: 'wrong-origin', nonce: 'a'.repeat(16), url, parse: { title: 'h1' } },
        origin: 'https://evil.example',
        source: window,
      }));
      setTimeout(() => resolve(seen), 300);
    }), { origin: cockpitOrigin, url: TICKET_URL });
    expect(responses.map((r) => r.requestId)).toEqual(['bad-nonce']);
    expect(responses[0].ok).toBe(false);
    expect(responses[0].error).toMatch(/nonce/i);

    // Rate limit: 10 reads/min per host: the 11th in the same window is refused, and the log has both kinds.
    for (let i = 0; i < 10; i += 1) {
      await page.evaluate(({ url }) => window.__constructClipperCore.handleBridgeRequest({ requestId: `r${Date.now()}`, nonce: 'a'.repeat(16), url, parse: { title: 'h1' } }), { url: TICKET_URL });
    }
    const limited = await page.evaluate(({ url }) => window.__constructClipperCore.handleBridgeRequest({ requestId: 'over', nonce: 'a'.repeat(16), url, parse: { title: 'h1' } }), { url: TICKET_URL });
    expect(limited.ok).toBe(false);
    expect(limited.error).toMatch(/rate limit/i);

    const log = await page.evaluate(() => window.__constructClipperCore.getActivityLog());
    expect(log.some((e) => e.ok === false && e.reason === 'host not approved')).toBe(true);
    expect(log.some((e) => e.ok === true)).toBe(true);
    expect(log.some((e) => e.reason === 'rate limited')).toBe(true);

    // The activity log is visible in the userscript menu (acceptance bullet), not just in memory.
    await page.evaluate(() => {
      const cmd = window.__constructClipperMenuCommands.find((c) => /activity log/i.test(c.label));
      cmd.fn();
    });
    const alerts = await page.evaluate(() => window.__constructClipperAlerts);
    expect(alerts[alerts.length - 1]).toContain('acme.atlassian.net');
  });

  test('Picker: clicking fields emits stable selectors with match count and preview, ignores an unlabelled decoy, and proposes a diff', async ({ page }) => {
    const ticketOrigin = 'https://ticket.example.invalid';
    await page.route(`${ticketOrigin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: TICKET_HTML }));
    await page.addInitScript(gmStubsScript({ cockpitOrigin: 'http://cockpit.example.invalid', ticketUrl: TICKET_URL, ticketHtml: TICKET_HTML }));
    await page.addInitScript(SCRIPT_SOURCE);
    await page.goto(`${ticketOrigin}/browse/STORE-142`);

    const title = await page.evaluate(() => window.__constructClipperCore.pickField('title', document.querySelector('[data-testid="issue.title"]')));
    expect(title.ok).toBe(true);
    expect(title.selector).toEqual({ css: '[data-testid="issue.title"]' }); // data-testid first, never a positional index (design 9.6b)
    expect(title.matchCount).toBe(1);
    expect(title.preview).toBe('Refund a delivered order');

    const status = await page.evaluate(() => window.__constructClipperCore.pickField('status', document.querySelector('#issue-status')));
    expect(status.selector).toEqual({ css: '#issue-status' });

    const description = await page.evaluate(() => window.__constructClipperCore.pickField('description', document.querySelector('div.description')));
    expect(description.matchCount).toBe(1);

    const proposal = await page.evaluate(() => window.__constructClipperCore.proposeSelectors());
    expect(proposal.ok).toBe(true);
    expect(proposal.proposal.url).toBe(`${ticketOrigin}/browse/STORE-142`);
    expect(proposal.proposal.parse).toEqual({
      title: { css: '[data-testid="issue.title"]' },
      status: { css: '#issue-status' },
      description: { css: 'div.description' },
    });
    expect(JSON.stringify(proposal)).not.toContain('marketing copy'); // the decoy paragraph was never picked
  });
});

test.describe.serial('Server: the Picker\'s proposal saves as a reviewable diff to story.md (#386)', () => {
  let repo;
  let restore;

  test.beforeAll(async () => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og386-story-bridge-')));
    fs.mkdirSync(path.join(repo, 'features/checkout'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'architecture.yml'),
      'version: 1\npreset: strict-nextjs\n\nproject:\n  framework: nextjs\n  language: typescript\n\nfeatures:\n  root: features\n',
    );
    fs.writeFileSync(
      path.join(repo, 'features/checkout/story.md'),
      '---\nsources: []\n---\n# Refund a delivered order\n\nWritten by hand.\n',
    );
    const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    restore = await openProject(API, repo);
  });
  test.afterAll(async () => {
    await restore?.();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('preview computes the diff without writing; save writes it and never touches the hand-written body', async ({ request }) => {
    const parse = { title: { xpath: "//h1[@data-testid='issue.title']" }, description: 'div.description' };

    const preview = await request.post(`${API}/api/story-bridge/preview`, { data: { feature: 'checkout', url: TICKET_URL, parse } });
    expect(preview.status()).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.ok).toBe(true);
    expect(previewBody.changed).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'features/checkout/story.md'), 'utf8')).not.toContain('sources:\n  - url'); // preview writes nothing

    const save = await request.post(`${API}/api/story-bridge/save`, { data: { feature: 'checkout', url: TICKET_URL, parse } });
    expect(save.status()).toBe(200);
    const saveBody = await save.json();
    expect(saveBody.ok).toBe(true);
    expect(saveBody.changed).toBe(true);

    const onDisk = fs.readFileSync(path.join(repo, 'features/checkout/story.md'), 'utf8');
    expect(onDisk).toContain('Written by hand.');
    expect(onDisk).toContain(TICKET_URL);
    expect(onDisk).toContain('div.description');

    // Proposing the exact same selectors again is a no-op diff, not a second write.
    const again = await request.post(`${API}/api/story-bridge/save`, { data: { feature: 'checkout', url: TICKET_URL, parse } });
    expect((await again.json()).changed).toBe(false);
  });

  test('rejects what the userscript itself would reject: a javascript: selector, an oversized one, a non-https URL and an unknown feature', async ({ request }) => {
    const badSelector = await request.post(`${API}/api/story-bridge/preview`, { data: { feature: 'checkout', url: TICKET_URL, parse: { title: 'javascript:alert(1)' } } });
    expect(badSelector.status()).toBe(422);

    const oversized = await request.post(`${API}/api/story-bridge/preview`, { data: { feature: 'checkout', url: TICKET_URL, parse: { title: `h1.${'x'.repeat(250)}` } } });
    expect(oversized.status()).toBe(422);

    const notHttps = await request.post(`${API}/api/story-bridge/preview`, { data: { feature: 'checkout', url: 'http://acme.atlassian.net/browse/STORE-142', parse: { title: 'h1' } } });
    expect(notHttps.status()).toBe(400);

    const noStory = await request.post(`${API}/api/story-bridge/preview`, { data: { feature: 'no-such-feature', url: TICKET_URL, parse: { title: 'h1' } } });
    expect(noStory.status()).toBe(404);

    // Untouched by any of the refused attempts above.
    expect(fs.readFileSync(path.join(repo, 'features/checkout/story.md'), 'utf8')).toContain('Written by hand.');
  });
});
