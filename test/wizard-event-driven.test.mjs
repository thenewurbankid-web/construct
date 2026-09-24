import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runImportRouteWizardEventDriven } from '../packages/core/cli.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-wizard-event-');
}

function buildRouteFixture(imports, extraFiles) {
  const dir = makeTempDir('construct-wizard-event-route-');
  const importLines = imports.map((spec, i) => `import x${i} from "${spec}";`).join('\n');
  fs.writeFileSync(path.join(dir, 'page.tsx'), `${importLines}\nexport default function Page() { return null; }\n`);
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

/** Drives one runImportRouteWizardEventDriven session end to end: answers
 * each `question` event with the next scripted answer (deferred to a
 * microtask — the very first question event fires *synchronously* inside
 * the call to runImportRouteWizardEventDriven itself, before this function
 * has anywhere to hang a reference to the returned session handle), and
 * collects every event into an array for the caller to assert against. */
function driveEventDrivenWizard(seedRoute, answers) {
  const events = [];
  const queue = [...answers];
  let session;
  session = runImportRouteWizardEventDriven((event) => {
    events.push(event);
    if (event.type === 'question') {
      const answer = queue.shift() ?? '';
      queueMicrotask(() => session.answer(answer));
    }
  }, seedRoute);
  return { events, done: session.done };
}

/** Fake "claude" analysis that distinguishes concurrent calls by which
 * route directory's basename shows up in the prompt, so two sessions
 * running at once each get back a plan for their own feature/route, not
 * whichever happened to be registered last (the failure mode a shared,
 * order-dependent single-stub would hide). */
function withRoutedFakeAnalysis(planForPrompt, fn) {
  const original = PROVIDERS.claude;
  PROVIDERS.claude = (prompt) => JSON.stringify(planForPrompt(prompt));
  return (async () => {
    try {
      return await fn();
    } finally {
      PROVIDERS.claude = original;
    }
  })();
}

async function inProject(dir, fn) {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

// #80 — regression test for the fix: two wizard sessions started at the same
// time (both mid-flight, interleaved via real awaits/microtasks, sharing one
// process) must each only ever see their own question/log events. Before
// the AsyncLocalStorage fix, the global console monkey-patch this adapter
// used meant session B's captured output leaked into session A's event
// stream (and vice versa), and whichever session finished first tore down
// the console patch out from under the other, still-running one.
test('runImportRouteWizardEventDriven: two concurrent sessions never cross-talk in their captured events', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout-a');
  createFeature(dir, 'checkout-b');
  const routeA = buildRouteFixture(['./OldA'], { 'OldA.ts': 'export function oldA() { return true; }\n' });
  const routeB = buildRouteFixture(['./OldB'], { 'OldB.ts': 'export function oldB() { return true; }\n' });

  await inProject(dir, () =>
    withRoutedFakeAnalysis(
      (prompt) => {
        if (prompt.includes('OldA.ts')) return { feature: 'checkout-a', units: [{ name: 'FooA', layers: ['domain'], from: 'OldA.ts' }] };
        if (prompt.includes('OldB.ts')) return { feature: 'checkout-b', units: [{ name: 'FooB', layers: ['domain'], from: 'OldB.ts' }] };
        throw new Error(`unexpected analysis prompt: ${prompt.slice(0, 200)}`);
      },
      async () => {
        // Both sessions started before either is awaited — genuinely
        // interleaved, not sequential.
        const sessionA = driveEventDrivenWizard(routeA, ['checkout-a', '', 'n', 'y']);
        const sessionB = driveEventDrivenWizard(routeB, ['checkout-b', '', 'n', 'y']);
        await Promise.all([sessionA.done, sessionB.done]);

        const textOf = (events) => events.filter((e) => e.type === 'log').map((e) => e.text).join('\n');
        const textA = textOf(sessionA.events);
        const textB = textOf(sessionB.events);

        // Each session's own output shows up...
        assert.match(textA, /checkout-a/);
        assert.match(textB, /checkout-b/);
        // ...and never the other session's.
        assert.doesNotMatch(textA, /checkout-b/);
        assert.doesNotMatch(textB, /checkout-a/);
        assert.doesNotMatch(textA, /FooB/);
        assert.doesNotMatch(textB, /FooA/);
      },
    ),
  );

  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout-a', 'domain', 'FooA.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout-b', 'domain', 'FooB.tsx')), true);
});

test('runImportRouteWizardEventDriven: a single session still captures its own output and emits done', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = buildRouteFixture(['./Old'], { 'Old.ts': 'export function old() { return true; }\n' });

  await inProject(dir, () =>
    withRoutedFakeAnalysis(
      () => ({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'Old.ts' }] }),
      async () => {
        const { events, done } = driveEventDrivenWizard(routeDir, ['checkout', '', 'n', 'y']);
        await done;
        assert.ok(events.some((e) => e.type === 'question' && e.text.includes('Destination feature')));
        assert.ok(events.some((e) => e.type === 'done'));
        assert.ok(events.some((e) => e.type === 'log' && e.text.includes('checkout')));
      },
    ),
  );

  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
});

test('the route question is tagged expects:"route" (so the Cockpit can offer a picker); the feature-name question is not', async () => {
  const dir = tmpProject();
  const original = process.cwd();
  process.chdir(dir);
  try {
    const { events, done } = driveEventDrivenWizard(undefined, ['checkout', '']);
    await done;
    const questions = events.filter((e) => e.type === 'question');
    assert.equal(questions[0].expects, undefined, 'the feature-name question wants free text');
    assert.equal(questions[1].expects, 'route');
  } finally {
    process.chdir(original);
  }
});
