import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReadability, READABILITY_RULES } from '../packages/core/readability-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, '..', 'fixtures');

function tmpRoot() {
  return makeTempDir('construct-readability-');
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test('READABILITY_RULES is shaped like config.mjs DEFAULT_RULES', () => {
  for (const [id, def] of Object.entries(READABILITY_RULES)) {
    assert.match(id, /^READ-\d{3}$/);
    assert.ok(['error', 'warning', 'off'].includes(def.severity));
    assert.equal(typeof def.name, 'string');
  }
});

test('READ-001: fixtures/readability-naming produces the exact guiding messages for a mis-named component and hook', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-naming'));
  const naming = violations.filter((v) => v.rule === 'READ-001');
  assert.equal(naming.length, 2);

  const component = naming.find((v) => v.file === 'features/demo/components/button.tsx');
  assert.equal(component.module, 'readability');
  assert.equal(component.severity, 'error');
  assert.equal(component.message, 'Component file "button.tsx" does not follow PascalCase naming matching its export.');
  assert.equal(component.suggestedFix, 'Rename features/demo/components/button.tsx to features/demo/components/Button.tsx.');

  const hook = naming.find((v) => v.file === 'features/demo/hooks/toggle.ts');
  assert.equal(hook.message, 'Hook file "toggle.ts" does not export a use-prefixed camelCase function matching its filename.');
  assert.equal(
    hook.suggestedFix,
    'Rename features/demo/hooks/toggle.ts to features/demo/hooks/useToggle.ts and export a function named useToggle.'
  );
});

test('READ-001: a correctly named component/hook produces no naming violation', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/Card.tsx', `export function Card() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/hooks/useCard.ts', `export function useCard() {\n  return true;\n}\n`);
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('READ-002: fixtures/readability-length flags an oversized file and an oversized function', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-length'));
  const length = violations.filter((v) => v.rule === 'READ-002');

  const bigFile = length.find((v) => v.file === 'features/demo/domain/BigFile.ts');
  assert.ok(bigFile, 'expected a file-length violation for BigFile.ts');
  assert.equal(bigFile.message, 'File is 206 lines, exceeding the 200-line threshold.');
  assert.equal(bigFile.suggestedFix, 'Split features/demo/domain/BigFile.ts into smaller modules along its distinct exports/responsibilities.');

  const longFn = length.find((v) => v.file === 'features/demo/services/LongFunctionService.ts');
  assert.ok(longFn, 'expected a function-length violation for LongFunctionService.ts');
  assert.match(longFn.message, /^Function "processAll" is approximately \d+ lines, exceeding the 40-line guideline\.$/);
  assert.match(longFn.suggestedFix, /^Extract part of "processAll" \(starting at line \d+\) in features\/demo\/services\/LongFunctionService\.ts into a smaller, named helper function\.$/);
});

test('READ-002: max-loc threshold is configurable via architecture.yml rules.READ-002-max-loc', () => {
  const root = tmpRoot();
  const lines = Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  writeFile(root, 'features/demo/domain/Small.ts', lines);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-002-max-loc: 10\n');
  const { violations } = validateReadability(root);
  assert.ok(violations.some((v) => v.rule === 'READ-002' && v.file === 'features/demo/domain/Small.ts' && v.line === 1));
});

test('READ-003: fixtures/readability-jsdoc flags only the undocumented public export', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-jsdoc'));
  const jsdocViolations = violations.filter((v) => v.rule === 'READ-003');
  assert.equal(jsdocViolations.length, 1);
  const v = jsdocViolations[0];
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/demo/index.ts');
  assert.equal(v.message, 'Public API export "startDemo" has no JSDoc summary.');
  assert.equal(
    v.suggestedFix,
    'Add a JSDoc block above "startDemo" in features/demo/index.ts, e.g. /** Describe what startDemo does and when to use it. */'
  );
  assert.ok(!jsdocViolations.some((x) => x.message.includes('stopDemo')));
});

// #19 / epic #76: a decorator sitting between a JSDoc block and the declaration it
// documents used to break "immediately preceding" association under regex-based
// parsing (extractJsdoc would return null), so READ-003 would wrongly flag a
// decorated, JSDoc'd public export as undocumented. Now that parser.mjs's
// extractJsdoc is AST-based (#88), readability-enforcer.mjs — which consumes it
// unchanged — should associate the JSDoc correctly with no code changes of its own.
test('READ-003: a JSDoc above a decorator on a public export is correctly associated (#19)', () => {
  const root = tmpRoot();
  writeFile(
    root,
    'features/demo/index.ts',
    `/** The demo feature's widget component. */\n@Component({ selector: 'app-widget' })\nexport class Widget {}\n`
  );
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-003').length, 0);
});

// ---- #493: READ-001 must not pick a Props/type export over the real component ---

test('READ-001: an exported <Name>Props interface above the component does not trigger a rename (#493)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/canvas/components/CanvasStage.tsx', `export interface CanvasStageProps {\n  width: number;\n}\n\nexport function CanvasStage({ width }: CanvasStageProps) {\n  return <div style={{ width }} />;\n}\n`);
  writeFile(root, 'features/canvas/components/Card.tsx', `export type CardProps = { a: string };\nexport const Card = ({ a }: CardProps) => <div>{a}</div>;\n`);
  writeFile(root, 'features/canvas/controllers/CanvasController.tsx', `type Local = { a: string };\nexport type { Local };\nexport function CanvasController() {\n  return <div />;\n}\n`);
  const { violations } = validateReadability(root);
  assert.deepEqual(violations.filter((v) => v.rule === 'READ-001'), []);
});

test('READ-001: a genuine mismatch still suggests the value export, never the Props type (#493)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/canvas/components/Stage.tsx', `export interface CanvasStageProps {\n  width: number;\n}\nexport function CanvasStage() {\n  return <div />;\n}\n`);
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-001');
  assert.ok(v, 'expected a READ-001 violation');
  assert.equal(v.suggestedFix, 'Rename features/canvas/components/Stage.tsx to features/canvas/components/CanvasStage.tsx.');
});

test('READ-001: a file exporting only types still fails READ-001 (#493)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/canvas/components/Only.tsx', `export interface OnlyProps {\n  a: string;\n}\n`);
  const { violations } = validateReadability(root);
  assert.ok(violations.some((x) => x.rule === 'READ-001'));
});

// ---- #516: READ-001 must not fight #512's Name.layer.ext convention ---

test('READ-001: a correctly ".layer"-suffixed component/controller/hook passes both READ-001 and READ-004 (#516)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/WidgetCard.component.tsx', `export function WidgetCard() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/controllers/WidgetController.controller.tsx', `export function WidgetController() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/hooks/useWidgetProvider.provider.ts', `export function useWidgetProvider() {\n  return defineProvider('WidgetProvider', () => ({}));\n}\n`);
  writeFile(root, 'features/demo/hooks/useWidget.hook.ts', `export function useWidget() {\n  return true;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0, 'expected no READ-001 violations');
  assert.equal(violations.filter((v) => v.rule === 'READ-004').length, 0, 'expected no READ-004 violations');
});

test('READ-001: a genuine mismatch with no layer suffix still fails exactly as before (#516)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/WidgetCard.tsx', `export function Widget() {\n  return <div />;\n}\n`);
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-001');
  assert.ok(v, 'expected a READ-001 violation');
  assert.equal(v.message, 'Component file "WidgetCard.tsx" does not follow PascalCase naming matching its export.');
  assert.equal(v.suggestedFix, 'Rename features/demo/components/WidgetCard.tsx to features/demo/components/Widget.tsx.');
});

test('READ-001: a WRONG layer suffix (mis-suffixed file) still trips READ-001, not silently accepted (#516)', () => {
  const root = tmpRoot();
  // Sits in components/ (so its real layer is "component") but is suffixed ".controller" --
  // stripReadOneSuffix only ever strips the EXPECTED suffix for the file's real layer, so this
  // wrong suffix stays part of the compared name and still breaks the PascalCase shape.
  writeFile(root, 'features/demo/components/Foo.controller.tsx', `export function Foo() {\n  return <div />;\n}\n`);
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-001');
  assert.ok(v, 'expected a READ-001 violation for a wrongly-suffixed file');
});

test('READ-001: a correctly-suffixed file with a genuine export mismatch still fails, with the suffix preserved in the suggested rename (#516)', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/WidgetCard.component.tsx', `export function Widget() {\n  return <div />;\n}\n`);
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-001');
  assert.ok(v, 'expected a READ-001 violation');
  assert.equal(
    v.suggestedFix,
    'Rename features/demo/components/WidgetCard.component.tsx to features/demo/components/Widget.component.tsx.'
  );
});

// ---- #512: READ-004 (filename encodes layer, Name.layer.ext) ----------

// Off by default (DEFAULT_RULES / READABILITY_RULES both say 'off') -- every existing fixture
// in this repo (readability-naming/-length/-jsdoc among them) predates this convention and
// must produce zero READ-004 violations with no architecture.yml at all.
test('READ-004 is off by default: no violation on any pre-existing, non-conforming fixture', () => {
  for (const fixture of ['readability-naming', 'readability-length', 'readability-jsdoc']) {
    const { violations } = validateReadability(path.join(fixturesRoot, fixture));
    assert.equal(violations.filter((v) => v.rule === 'READ-004').length, 0, `expected no READ-004 in ${fixture}`);
  }
});

test('READ-004: opting in (rules: READ-004: warning) flags a domain file with no ".domain" suffix', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/domain/AddWidget.ts', `export function AddWidget(x) {\n  return x;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: warning\n');
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-004');
  assert.ok(v, 'expected a READ-004 violation');
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/demo/domain/AddWidget.ts');
  assert.equal(
    v.message,
    'File "AddWidget.ts" does not encode its layer in its filename (expected a ".domain" suffix before the extension).'
  );
  assert.equal(v.suggestedFix, 'Rename features/demo/domain/AddWidget.ts to features/demo/domain/AddWidget.domain.ts.');
});

test('READ-004: a correctly suffixed file produces no violation once opted in', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/domain/AddWidget.domain.ts', `export function AddWidget(x) {\n  return x;\n}\n`);
  writeFile(root, 'features/demo/components/WidgetCard.component.tsx', `export function WidgetCard() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/services/WidgetService.service.ts', `export function fetchWidget() {\n  return null;\n}\n`);
  writeFile(root, 'features/demo/workflows/WidgetWorkflow.workflow.ts', `export const machine = { states: { idle: {} } };\n`);
  writeFile(root, 'features/demo/pages/WidgetPage.page.tsx', `export function WidgetPage() {\n  return <div />;\n}\n`);
  writeFile(root, 'features/demo/controllers/WidgetController.controller.tsx', `export function WidgetController() {\n  return <div />;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-004').length, 0);
});

test('READ-004: a mis-suffixed file (wrong layer suffix) is flagged with a clean (non-doubled) suggested rename', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/Foo.controller.tsx', `export function Foo() {\n  return <div />;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  const v = violations.find((x) => x.rule === 'READ-004');
  assert.ok(v);
  assert.equal(v.suggestedFix, 'Rename features/demo/components/Foo.controller.tsx to features/demo/components/Foo.component.tsx.');
});

// The hook layer splits into three suffixes depending on which factory (if any) the file
// actually calls -- the same defineProvider(...)/useTrackedState(...) presence check
// HOOK-002/HOOK-001 already use, per #499's design (Provider hooks and tracked-state hooks
// follow genuinely different rules, so they don't share one generic ".hook" suffix).
test('READ-004: hook layer expects ".provider", ".state" or ".hook" depending on which factory the file calls', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/hooks/useWidgetProvider.ts', `export function useWidgetProvider() {\n  return defineProvider('WidgetProvider', () => ({}));\n}\n`);
  writeFile(root, 'features/demo/hooks/useWidgetState.ts', `export const useWidgetState = useTrackedState(0);\n`);
  writeFile(root, 'features/demo/hooks/useWidget.ts', `export function useWidget() {\n  return true;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  const byFile = Object.fromEntries(violations.filter((v) => v.rule === 'READ-004').map((v) => [v.file, v]));

  assert.equal(
    byFile['features/demo/hooks/useWidgetProvider.ts'].suggestedFix,
    'Rename features/demo/hooks/useWidgetProvider.ts to features/demo/hooks/useWidgetProvider.provider.ts.'
  );
  assert.equal(
    byFile['features/demo/hooks/useWidgetState.ts'].suggestedFix,
    'Rename features/demo/hooks/useWidgetState.ts to features/demo/hooks/useWidgetState.state.ts.'
  );
  assert.equal(
    byFile['features/demo/hooks/useWidget.ts'].suggestedFix,
    'Rename features/demo/hooks/useWidget.ts to features/demo/hooks/useWidget.hook.ts.'
  );
});

test('READ-004: correctly suffixed hook files (.provider.ts / .state.ts / .hook.ts) produce no violation', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/hooks/useWidgetProvider.provider.ts', `export function useWidgetProvider() {\n  return defineProvider('WidgetProvider', () => ({}));\n}\n`);
  writeFile(root, 'features/demo/hooks/useWidgetState.state.ts', `export const useWidgetState = useTrackedState(0);\n`);
  writeFile(root, 'features/demo/hooks/useWidget.hook.ts', `export function useWidget() {\n  return true;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-004').length, 0);
});

// #531 -- expectedHookSuffix's factory-presence check must also recognize defineProvider/
// useTrackedState called with an explicit generic type argument (defineProvider<Props>(...),
// useTrackedState<T>(...)), the same gap #521 fixed in architecture-enforcer.mjs's own
// EXPR-006/HOOK-001/HOOK-002 checks -- not just the plain factoryName(...) shape. Both files
// here are suffix-less, so a suffix suggestion (".provider"/".state") is the proof they were
// correctly recognized as built through the generic-argument call, not falling through to the
// generic ".hook" suffix.
test('#531: READ-004 suggests ".provider"/".state" for a hook built via a generic-argument factory call', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/hooks/useCartProvider.ts', `export const useCartProvider = defineProvider<CartState>('Cart', () => ({ total: 0 }));\n`);
  writeFile(root, 'features/demo/hooks/useCartState.ts', `export const useCartState = useTrackedState<number>('total', 0);\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-004: error\n');
  const { violations } = validateReadability(root);
  const byFile = Object.fromEntries(violations.filter((v) => v.rule === 'READ-004').map((v) => [v.file, v]));
  assert.equal(
    byFile['features/demo/hooks/useCartProvider.ts'].suggestedFix,
    'Rename features/demo/hooks/useCartProvider.ts to features/demo/hooks/useCartProvider.provider.ts.'
  );
  assert.equal(
    byFile['features/demo/hooks/useCartState.ts'].suggestedFix,
    'Rename features/demo/hooks/useCartState.ts to features/demo/hooks/useCartState.state.ts.'
  );
});

// Route files (app/**/page.tsx, src/App.tsx) are exempt per #512's design -- moot here in
// practice, since validateReadability only ever walks features/*/**, never a route file, so
// there is nothing extra to assert beyond that a route-shaped path never appears in `files`.

test('rule severity can be overridden to "off" via architecture.yml', () => {
  const root = tmpRoot();
  writeFile(root, 'features/demo/components/lowercase.tsx', `export function lowercase() {\n  return <div />;\n}\n`);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'rules:\n  READ-001: off\n');
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('exceptions scoped to a path suppress a rule for that path', () => {
  const root = tmpRoot();
  writeFile(root, 'features/legacy/components/legacyThing.tsx', `export function legacyThing() {\n  return <div />;\n}\n`);
  fs.writeFileSync(
    root + '/architecture.yml',
    'exceptions:\n  - rule: READ-001\n    path: features/legacy/**\n    reason: legacy code\n    owner: platform\n'
  );
  const { violations } = validateReadability(root);
  assert.equal(violations.filter((v) => v.rule === 'READ-001').length, 0);
});

test('every produced violation is a valid diagnostics-contract violation with module "readability"', () => {
  const { violations } = validateReadability(path.join(fixturesRoot, 'readability-naming'));
  assert.ok(violations.length > 0);
  for (const v of violations) assert.equal(v.module, 'readability');
});
