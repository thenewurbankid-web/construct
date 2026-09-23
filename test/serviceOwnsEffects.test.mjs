// SERVICE-001 (#589): registered at error severity in every architecture.yml since the rule
// engine's beginning, but had no detector anywhere in architecture-enforcer.mjs (or elsewhere)
// -- it could never fire. Distinct job from SERVICE-002 (which checks the service layer's OWN
// files for a banned React/UI import): SERVICE-001 runs the other direction -- only the service
// layer may perform an external effect (network call, browser storage, a polling timer) at all,
// so a component/hook/page/controller doing one directly is the violation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const on001 = (layer, source) => detectLayerViolations(layer, source).filter((v) => v.rule === 'SERVICE-001');

const FETCH_HOOK = `export function useThing() {\n  const load = () => fetch('/api/thing');\n  return load;\n}\n`;
const LOCAL_STORAGE_COMPONENT = `export function Widget() {\n  const cached = localStorage.getItem('x');\n  return cached;\n}\n`;
const SESSION_STORAGE_COMPONENT = `export function Widget() {\n  sessionStorage.setItem('x', '1');\n  return null;\n}\n`;
const AXIOS_HOOK = `import axios from 'axios';\nexport function useThing() {\n  return axios.get('/api/thing');\n}\n`;
const WEBSOCKET_CONSTRUCTED_HOOK = `export function useThing() {\n  const ws = new WebSocket('wss://x');\n  return ws;\n}\n`;
const XHR_COMPONENT = `export function Widget() {\n  const xhr = new XMLHttpRequest();\n  return xhr;\n}\n`;
const SET_INTERVAL_HOOK = `export function useThing() {\n  const t = setInterval(() => {}, 500);\n  return t;\n}\n`;

// #589's own regression: WebSocket/XMLHttpRequest are DOM-lib globals that are simultaneously a
// real constructor AND a TS type of the same spelling. A type-position reference (already
// confirmed on this repo's real ui/client: useProcessesLive.tsx, useWizard.tsx) only says what a
// value -- already handed back by a properly-abstracted service call -- is typed as; it never
// itself performs the effect, so it must not fire.
const WEBSOCKET_TYPE_ONLY_HOOK = `import { connectSocket } from '../services/Socket';\nexport function useThing() {\n  const wsRef = { current: null as WebSocket | null };\n  wsRef.current = connectSocket();\n  return wsRef;\n}\n`;
const XHR_TYPE_ONLY_COMPONENT = `import { openRequest } from '../services/Xhr';\nexport function Widget() {\n  let xhr: XMLHttpRequest | null = null;\n  xhr = openRequest();\n  return xhr;\n}\n`;

const PAGE_FETCH = `export function Page() {\n  fetch('/api/thing');\n  return null;\n}\n`;
const CONTROLLER_FETCH = `export function controller() {\n  fetch('/api/thing');\n  return null;\n}\n`;
const PAGE_LOCAL_STORAGE = `export function Page() {\n  localStorage.getItem('x');\n  return null;\n}\n`;

const SERVICE_FETCH = `export function getThing() {\n  return fetch('/api/thing');\n}\n`;
const SERVICE_LOCAL_STORAGE = `export function cacheThing(v) {\n  localStorage.setItem('x', v);\n}\n`;
const PURE_HOOK = `export function useThing() {\n  return 1;\n}\n`;

test('SERVICE-001 is registered at error severity', () => {
  assert.equal(DEFAULT_RULES['SERVICE-001'].severity, 'error');
});

test('SERVICE-001: fires in component/hook/page/controller for each effect kind -- fetch, localStorage, sessionStorage, axios, new WebSocket(), new XMLHttpRequest(), setInterval', () => {
  const cases = [
    ['hook', FETCH_HOOK, 'fetch'],
    ['component', LOCAL_STORAGE_COMPONENT, 'localStorage'],
    ['component', SESSION_STORAGE_COMPONENT, 'sessionStorage'],
    ['hook', AXIOS_HOOK, 'axios'],
    ['hook', WEBSOCKET_CONSTRUCTED_HOOK, 'WebSocket'],
    ['component', XHR_COMPONENT, 'XMLHttpRequest'],
    ['hook', SET_INTERVAL_HOOK, 'setInterval'],
  ];
  for (const [layer, src, name] of cases) {
    const v = on001(layer, src);
    assert.equal(v.length, 1, `${layer}/${name}`);
    assert.match(v[0].message, new RegExp(name), `${layer}/${name} message names the identifier`);
    assert.deepEqual(v[0].expected, ['service']);
    assert.match(v[0].suggestedFix, /service/);
    assert.match(v[0].why, /Services own external effects/);
  }
});

test('SERVICE-001: a WebSocket/XMLHttpRequest reference used only as a TS type (never constructed) is not a violation', () => {
  assert.deepEqual(on001('hook', WEBSOCKET_TYPE_ONLY_HOOK), []);
  assert.deepEqual(on001('component', XHR_TYPE_ONLY_COMPONENT), []);
});

test('SERVICE-001: page/controller calling fetch() fires only their own existing rule (PAGE-004/CONTROLLER-001), not SERVICE-001 a second time for the identical call', () => {
  assert.deepEqual(detectLayerViolations('page', PAGE_FETCH).map((v) => v.rule), ['PAGE-004']);
  assert.deepEqual(detectLayerViolations('controller', CONTROLLER_FETCH).map((v) => v.rule), ['CONTROLLER-001']);
});

test('SERVICE-001: page/controller ARE covered for the effects their narrower fetch()-only rule misses (e.g. localStorage)', () => {
  const v = on001('page', PAGE_LOCAL_STORAGE);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /localStorage/);
});

test('SERVICE-001: never fires on the service layer itself, or on a layer with no effect at all', () => {
  assert.deepEqual(on001('service', SERVICE_FETCH), []);
  assert.deepEqual(on001('service', SERVICE_LOCAL_STORAGE), []);
  assert.deepEqual(on001('hook', PURE_HOOK), []);
});

test('SERVICE-001: validateArchitecture (the source of `--format json`) has the same fields as other rules, with a concrete file:line and a suggestedFix naming a service', () => {
  const dir = makeTempDir('construct-service001-');
  const yml = 'version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n';
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml);
  fs.mkdirSync(path.join(dir, 'features/shop/hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/hooks/useCart.tsx'), FETCH_HOOK);
  const all = () => validateArchitecture(dir).violations;
  const found = all().filter((v) => v.rule === 'SERVICE-001');
  assert.equal(found.length, 1);
  const [v] = found;
  assert.equal(v.severity, 'error');
  assert.equal(v.file, 'features/shop/hooks/useCart.tsx');
  assert.equal(v.line, 2);
  assert.match(v.suggestedFix, /service/i);
  assert.deepEqual(Object.keys(v).sort(), ['docsUrl', 'expected', 'file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
  assert.equal(validateArchitecture(dir).ok, false);
});
