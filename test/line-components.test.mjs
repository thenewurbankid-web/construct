// cu4 -- the Components editor (packages/engine/line/components.mjs): one component's Behaviour, Events and States,
// read through Studio's linked Editor parts, and each edit a plan step that lands only through applyChange. Runs on a
// copy of examples/line-sample with the cu4 overlay (fixtures/line-cu4: a library Disclosure and orders/OrderDetails
// based on it). Studio's parts come from the link (packages/line-links, @mx/studio-editor); the tests that need them
// say so and skip when the link is down, and the static path is tested with the link switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { LineOpError, LINE_PLAN_TOOLS, assertStagedChange } from '../packages/engine/line/contract.mjs';
import { COMPONENT_OPS, componentApiOf, readLineComponent, setStudioLinked, studioEditor, workingCopyPath } from '../packages/engine/line/components.mjs';
import { applyChange } from '../packages/engine/line/ops.mjs';
import { createLinePlanRegistry } from '../packages/engine/line/planTools.mjs';
import { entryById } from '../packages/engine/line/toolRegistry.mjs';
import { LINE_CONTROLS } from '../packages/engine/line/controls.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(HERE, '../examples/line-sample');
const OVERLAY = path.resolve(HERE, '../fixtures/line-cu4');
const FILE = 'features/orders/components/OrderDetails.tsx';
const LIB = 'library/components/Disclosure.tsx';
const copy = () => {
  const dir = makeTempDir('line-components-');
  fs.cpSync(SAMPLE, dir, { recursive: true });
  for (const sub of ['library', 'features']) fs.cpSync(path.join(OVERLAY, sub), path.join(dir, sub), { recursive: true });
  return dir;
};
const refused = (code) => (e) => e instanceof LineOpError && e.code === code && /[.?!]$/.test(e.sentence);
const land = (root, staged) => { assertStagedChange(staged); const r = applyChange(root, staged); assert.equal(r.ok, true, r.sentence); return r; };
const linked = studioEditor().ok;
const needsStudio = linked ? {} : { skip: `Studio is not linked here: ${studioEditor().sentence}` };
const CLICK = { kind: 'click', slot: 'trigger' };

test('the API of a Line component is read from its code: props, parts that take content, events', () => {
  const src = fs.readFileSync(path.join(OVERLAY, LIB), 'utf8');
  const api = componentApiOf(src, 'Disclosure', LIB);
  assert.deepEqual(api.props, { open: { type: 'boolean', required: false } });
  assert.deepEqual(api.slots, ['trigger', 'children']);
  assert.deepEqual(api.events, ['onOpenChange']);
  const typed = componentApiOf("type P = { size: 'sm' | 'lg'; count: number; label: string };\nexport function X({ size, count, label }: P) { return null; }", 'X', 'x.tsx');
  assert.deepEqual(typed.props, { size: { type: 'enum', required: true, values: ['sm', 'lg'] }, count: { type: 'number', required: true }, label: { type: 'string', required: true } });
});

test('a library component reads read-only, with the sentence that says how to change it', () => {
  const root = copy();
  const v = readLineComponent(root, LIB);
  assert.equal(v.readOnly, true);
  assert.match(v.readOnlySentence, /^Disclosure is a library component: complete, used as it is and never changed here\. Base a feature item on it/);
  assert.deepEqual(v.api.slots, ['trigger', 'children']);
  assert.throws(() => readLineComponent(root, 'features/orders/pages/OrdersPage.tsx'), refused('NOT_A_COMPONENT'));
  assert.throws(() => readLineComponent(root, 'nope.tsx'), refused('UNKNOWN_ITEM'));
});

test('every edit of a library component is refused with "base a feature item on it" and a typed base-on fix; nothing changes', () => {
  const root = copy();
  const before = fs.readFileSync(path.join(root, LIB), 'utf8');
  const calls = [
    () => COMPONENT_OPS.planAddComponentEvent(root, { file: LIB, source: CLICK, action: { kind: 'set', prop: 'open', value: true } }),
    () => COMPONENT_OPS.planAttachComponentPrimitive(root, { file: LIB, primitive: 'disclosure' }),
    () => COMPONENT_OPS.planChangeComponentEvent(root, { file: LIB, id: 'ev-1', action: { kind: 'set', prop: 'open', value: false } }),
    () => COMPONENT_OPS.planSetComponentState(root, { file: LIB, ref: 'disclosure-1', state: 'open' }),
  ];
  for (const call of calls) {
    try { call(); assert.fail('not refused'); } catch (e) {
      assert.ok(refused('LIBRARY_ITEM')(e), String(e));
      assert.match(e.sentence, /base a feature item on it and change that\.$/);
      assert.equal(e.fixes.length, 1);
      assert.deepEqual(e.fixes[0].step, { tool: 'line.baseOn', args: { libraryId: 'components/Disclosure', feature: 'billing', name: 'BillingDisclosure' } });
      assert.equal(e.fixes[0].rank, 1);
    }
  }
  assert.equal(fs.readFileSync(path.join(root, LIB), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, workingCopyPath(LIB))), false);
});

test('Behaviour: the disclosure fits OrderDetails; attaching it lands one working-copy file and draws its state diagram', needsStudio, () => {
  const root = copy();
  let v = readLineComponent(root, FILE);
  assert.equal(v.readOnly, false);
  assert.equal(v.via, 'studio');
  assert.ok(v.behaviour.fits.some((f) => f.primitive === 'disclosure'));
  assert.deepEqual(v.behaviour.primitives, []);
  const staged = COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' });
  assert.deepEqual(staged.files.map((f) => f.path), [workingCopyPath(FILE)]);
  assert.match(staged.summary, /^Gives OrderDetails in orders the disclosure behaviour \(/);
  assert.equal(fs.existsSync(path.join(root, workingCopyPath(FILE))), false, 'planning writes nothing');
  land(root, staged);
  v = readLineComponent(root, FILE);
  const [p] = v.behaviour.primitives;
  assert.equal(p.primitive, 'disclosure');
  assert.equal(p.ref, 'disclosure-1');
  assert.ok(p.roles.some((r) => r.role === 'trigger' && /^Clicking the trigger opens and closes it\.$/.test(r.sentence)));
  assert.deepEqual(p.diagram.states.map((s) => s.id).sort(), ['closed', 'open']);
  assert.equal(p.diagram.current, 'closed');
  assert.throws(() => COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' }), refused('NO_CHANGE'));
  assert.throws(() => COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'counter' }), refused('NO_FIT'));
  assert.deepEqual(validateLine(root).violations.map((x) => x.rule).sort(), ['LINE-BASE', 'LINE-DIR'], 'only the sample\'s two planted problems');
});

test('Events: add a When -> Do, see Studio\'s conflict warning and fix, change one; each lands through the writer', needsStudio, () => {
  const root = copy();
  land(root, COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' }));
  const add = COMPONENT_OPS.planAddComponentEvent(root, { file: FILE, source: CLICK, action: { kind: 'primitive', primitive: 'disclosure-1', action: 'open' } });
  assert.match(add.summary, /^Adds to OrderDetails: when the trigger is clicked, open the disclosure\.$/i);
  land(root, add);
  land(root, COMPONENT_OPS.planAddComponentEvent(root, { file: FILE, source: CLICK, action: { kind: 'primitive', primitive: 'disclosure-1', action: 'close' } }));
  let v = readLineComponent(root, FILE);
  const g = v.events.groups.find((x) => x.label.startsWith('Click on'));
  assert.equal(g.actions.length, 2);
  assert.equal(g.conflicts.length, 1);
  assert.match(g.conflicts[0], /nothing seems to happen/);
  assert.ok(g.fix, 'Studio offers a fix');
  land(root, COMPONENT_OPS.planFixComponentEvent(root, { file: FILE, ...g.fix }));
  v = readLineComponent(root, FILE);
  const after = v.events.groups.find((x) => x.label.startsWith('Click on'));
  assert.equal(after.conflicts.length, 0);
  const id = after.actions[0].wire;
  land(root, COMPONENT_OPS.planChangeComponentEvent(root, { file: FILE, id, action: { kind: 'set', prop: 'open', value: true } }));
  v = readLineComponent(root, FILE);
  assert.match(v.events.groups.flatMap((x) => x.actions).find((a) => a.wire === id).sentence, /open/i);
  assert.throws(() => COMPONENT_OPS.planAddComponentEvent(root, { file: FILE, source: { kind: 'click', slot: 'nope' }, action: { kind: 'set', prop: 'open', value: true } }), refused('UNKNOWN_PART'));
  assert.throws(() => COMPONENT_OPS.planAddComponentEvent(root, { file: FILE, source: CLICK, action: { kind: 'primitive', primitive: 'toggle-1', action: 'on' } }), refused('UNKNOWN_BEHAVIOUR'));
  assert.throws(() => COMPONENT_OPS.planChangeComponentEvent(root, { file: FILE, id: 'ev-99', action: { kind: 'set', prop: 'open', value: true } }), refused('UNKNOWN_EVENT'));
});

test('States: the live current state comes from the state graph; picking another state is a plan step', needsStudio, () => {
  const root = copy();
  land(root, COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' }));
  let v = readLineComponent(root, FILE);
  assert.deepEqual(v.states.current.map((c) => [c.ref, c.state]), [['disclosure-1', 'closed']]);
  assert.ok(v.states.rows.some((r) => r.id === 'open' && r.origin === 'own'));
  const staged = COMPONENT_OPS.planSetComponentState(root, { file: FILE, ref: 'disclosure-1', state: 'open' });
  assert.match(staged.summary, /^Sets OrderDetails's disclosure to open\.$/);
  land(root, staged);
  v = readLineComponent(root, FILE);
  assert.equal(v.states.current[0].state, 'open');
  assert.equal(v.behaviour.primitives[0].diagram.current, 'open');
  assert.match(v.states.current[0].shows ?? '', /open = true/);
  assert.throws(() => COMPONENT_OPS.planSetComponentState(root, { file: FILE, ref: 'disclosure-1', state: 'open' }), refused('NO_CHANGE'));
  assert.throws(() => COMPONENT_OPS.planSetComponentState(root, { file: FILE, ref: 'disclosure-1', state: 'ajar' }), refused('UNKNOWN_STATE'));
});

test('New component: a feature component based on a library component; anything else is refused', () => {
  const root = copy();
  const staged = COMPONENT_OPS.planNewComponent(root, { libraryId: 'components/Disclosure', feature: 'billing', name: 'InvoiceDetails' });
  assert.deepEqual(staged.files.map((f) => f.path), ['features/billing/components/InvoiceDetails.tsx']);
  assert.match(staged.files[0].content, /^\/\/ @line-base components\/Disclosure\n/);
  land(root, staged);
  assert.equal(readLineComponent(root, 'features/billing/components/InvoiceDetails.tsx').baseName, 'Disclosure');
  assert.throws(() => COMPONENT_OPS.planNewComponent(root, { libraryId: 'pages/ListPage', feature: 'billing', name: 'X' }), refused('UNKNOWN_ITEM'));
  assert.throws(() => COMPONENT_OPS.planNewComponent(root, { libraryId: 'components/Disclosure', feature: 'billing', name: 'InvoiceDetails' }), refused('NAME_TAKEN'));
});

test('the static path: with Studio unlinked the events still read as sentences and an event can still be added', async () => {
  const root = copy();
  await setStudioLinked(false);
  try {
    const v = readLineComponent(root, FILE);
    assert.equal(v.via, 'static');
    assert.match(v.viaSentence, /not linked/);
    assert.throws(() => COMPONENT_OPS.planAttachComponentPrimitive(root, { file: FILE, primitive: 'disclosure' }), refused('STUDIO_DOWN'));
    land(root, COMPONENT_OPS.planAddComponentEvent(root, { file: FILE, source: CLICK, action: { kind: 'set', prop: 'open', value: true } }));
    const after = readLineComponent(root, FILE);
    assert.equal(after.events.groups[0].actions[0].sentence, 'When the trigger is clicked, set open to true.');
  } finally {
    await setStudioLinked(true);
  }
});

test('the cu4 tools are in the contract, the one registry and the plan registry, and each has a control', async () => {
  const tools = ['line.attachComponentPrimitive', 'line.addComponentEvent', 'line.changeComponentEvent', 'line.fixComponentEvent', 'line.setComponentState', 'line.newComponent'];
  for (const t of tools) {
    assert.ok(LINE_PLAN_TOOLS.some((x) => x.name === t), `${t} in the contract`);
    const e = entryById(t);
    assert.ok(e && e.surfaces.plan && e.kind === 'write', `${t} in the tool registry`);
    assert.ok(LINE_CONTROLS.some((c) => c.toolId === t || c.tool === t), `${t} has a control`);
  }
  assert.ok(entryById('line.component')?.surfaces.http, 'the read route is registered');
  const root = copy();
  const reg = createLinePlanRegistry({ root });
  for (const t of tools) assert.ok(reg.list().some((x) => x.name === t), `${t} in the plan registry`);
  const r = await reg.call('line.newComponent', { libraryId: 'components/Disclosure', feature: 'billing', name: 'InvoiceDetails' });
  assert.equal(r.apply.ok, true, r.sentence);
  assert.ok(fs.existsSync(path.join(root, 'features/billing/components/InvoiceDetails.tsx')));
});
