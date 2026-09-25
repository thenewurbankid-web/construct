// #648 -- tiers, capabilities and `construct doctor`. Every machine here is a fixture handed in through the probe seam:
// nothing reads the real machine, nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIERS, TIER_ORDER, RAM_TOLERANCE, MIN_NODE_MAJOR, classifyMachine, capabilities, detectMachine, buildMachineReport, renderMachineText,
  optionalItems, localOllamaUrl, pingLocalOllama, machineAllowsModels, defaultProbes, countModelFiles, renderTierTable,
} from '../packages/core/machine.mjs';
import { doctor, renderDoctorText } from '../packages/core/cli.mjs';
import { openDecision, clearDecisionCache } from '../packages/core/decision-project.mjs';
import { withExitCodeSink, EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GB = 1024;

/** The reading of a machine a real 2, 4, 8 or 16 GB laptop gives (a little under its label), with everything optional installed unless said. */
const laptop = (gb, over = {}) => ({
  platform: () => 'linux',
  node: () => '22.14.0',
  cores: () => (gb <= 4 ? 2 : 8),
  totalRamMb: () => Math.round(gb * GB * 0.95),
  freeRamMb: () => 5000,
  freeDiskMb: () => 100 * GB,
  ffmpeg: () => true,
  ffprobe: () => true,
  playwrightBrowser: () => true,
  python3: () => true,
  kokoro: () => true,
  chatterbox: () => false,
  modelFiles: () => ({ onnx: 1, gguf: 0, megabytes: 80 }),
  ollamaUrl: () => 'http://127.0.0.1:11434',
  ollama: () => true,
  ...over,
});

test('the tier constants: Lite 2 cores 4 GB 1 GB disk, Cockpit use 8 GB, Contributor 8 GB workable 16 GB comfortable and about 6 GB disk', () => {
  assert.deepEqual(TIER_ORDER, ['lite', 'cockpit', 'contributor']);
  assert.deepEqual([TIERS.lite.cores, TIERS.lite.ramGb, TIERS.lite.diskGb], [2, 4, 1]);
  assert.equal(TIERS.cockpit.ramGb, 8);
  assert.deepEqual([TIERS.contributor.ramGb, TIERS.contributor.comfortableRamGb, TIERS.contributor.diskGb], [8, 16, 6]);
  assert.equal(MIN_NODE_MAJOR, 20);
});

test('classification of a 2, 4, 8 and 16 GB machine', async () => {
  const tier = async (gb, over) => buildMachineReport(await detectMachine(laptop(gb, over))).tier;
  const two = await tier(2);
  assert.equal(two.id, 'below-lite');
  assert.match(two.reason, /Lite needs 4 GB of memory \(this machine has 1\.9 GB\)/);
  const four = await tier(4);
  assert.deepEqual([four.id, four.name, four.comfort], ['lite', 'Lite', null]);
  assert.match(four.reason, /Cockpit use needs 8 GB of memory/);
  const eight = await tier(8);
  assert.deepEqual([eight.id, eight.comfort], ['contributor', 'workable']);
  assert.match(eight.reason, /one heavy job at a time/);
  const sixteen = await tier(16);
  assert.deepEqual([sixteen.id, sixteen.comfort], ['contributor', 'comfortable']);
  assert.match(sixteen.reason, /comfortably/);
});

test('a 16 GB laptop that shows 15.2 GB still meets 16, and the tolerance is the documented nine tenths', () => {
  assert.equal(RAM_TOLERANCE, 0.9);
  assert.equal(classifyMachine({ cores: 8, totalRamMb: 15603, freeDiskMb: 50 * GB }).comfort, 'comfortable');
  assert.equal(classifyMachine({ cores: 8, totalRamMb: 4 * GB * 0.9 - 1 }).id, 'below-lite');
  assert.equal(classifyMachine({ cores: 8, totalRamMb: 4 * GB * 0.9 }).id, 'lite');
});

test('cores and free disk hold a machine back, and the reason names what is short', () => {
  const fewCores = classifyMachine({ cores: 2, totalRamMb: 16 * GB, freeDiskMb: 100 * GB });
  assert.equal(fewCores.id, 'cockpit');
  assert.match(fewCores.reason, /Contributor needs 4 processor cores \(this machine has 2\)/);
  const fullDisk = classifyMachine({ cores: 8, totalRamMb: 16 * GB, freeDiskMb: 3 * GB });
  assert.equal(fullDisk.id, 'cockpit');
  assert.match(fullDisk.reason, /Contributor needs 6 GB of free disk \(this machine has 3 GB\)/);
  assert.equal(classifyMachine({ cores: 8, totalRamMb: 16 * GB, freeDiskMb: 0.5 * GB }).id, 'below-lite');
  assert.equal(classifyMachine({ cores: 1, totalRamMb: 16 * GB }).id, 'below-lite', 'one core is below Lite');
  assert.equal(classifyMachine({ cores: 8, totalRamMb: 16 * GB, freeDiskMb: null }).id, 'contributor', 'an unknown disk is not a shortfall');
});

test('capabilities is pure and answers per feature with a reason: a Lite machine is rules only', () => {
  const lite = { cores: 2, totalRamMb: 4 * GB, tools: { playwrightBrowser: true, ffmpeg: true, ffprobe: true }, models: { kokoro: true } };
  const before = JSON.stringify(lite);
  const c = capabilities(lite);
  assert.equal(JSON.stringify(lite), before, 'the machine is not touched');
  assert.deepEqual(capabilities(lite), c, 'the same machine gives the same answer');
  for (const key of ['modelProposals', 'cockpit', 'studioVoice', 'playwrightProofs']) assert.equal(c[key].available, false, key);
  assert.equal(c.modelProposals.reason, 'this machine is Lite (4 GB of memory, 2 cores) and loading a model needs 8 GB and 2 cores');
  assert.match(c.cockpit.reason, /needs 8 GB of memory \(this machine has 4 GB\)/);
});

test('capabilities on a capable machine: each feature also needs its own tool', () => {
  const big = { cores: 8, totalRamMb: 16 * GB };
  assert.equal(capabilities(big).modelProposals.available, true);
  assert.equal(capabilities(big).cockpit.available, true);
  assert.deepEqual(capabilities(big).playwrightProofs, { available: false, reason: 'no Playwright browser is installed' });
  assert.equal(capabilities({ ...big, tools: { playwrightBrowser: true } }).playwrightProofs.available, true);
  const voice = (tools, models) => capabilities({ ...big, tools, models }).studioVoice;
  assert.match(voice({}, {}).reason, /ffmpeg is not installed/);
  assert.match(voice({ ffmpeg: true }, {}).reason, /ffprobe is not installed/);
  assert.match(voice({ ffmpeg: true, ffprobe: true }, {}).reason, /no local voice/);
  assert.match(voice({ ffmpeg: true, ffprobe: true }, { chatterbox: true }).reason, /no local voice/, 'Chatterbox needs python3');
  assert.equal(voice({ ffmpeg: true, ffprobe: true, python3: true }, { chatterbox: true }).available, true);
  assert.match(voice({ ffmpeg: true, ffprobe: true }, { kokoro: true }).reason, /Kokoro/);
});

test('every optional item has a plain fix line when missing, and none when found', async () => {
  const missing = await detectMachine(laptop(16, { ffmpeg: () => false, ffprobe: () => false, playwrightBrowser: () => false, python3: () => false, kokoro: () => false, chatterbox: () => false, ollama: () => false }));
  const items = optionalItems(missing);
  assert.deepEqual(items.map((i) => i.id), ['ffmpeg', 'ffprobe', 'playwright', 'ollama', 'python3', 'kokoro', 'chatterbox']);
  for (const i of items) assert.ok(i.fix && i.found === false, `${i.id} has a fix line`);
  assert.equal(items.find((i) => i.id === 'ffmpeg').fix, 'sudo apt install ffmpeg');
  assert.equal(items.find((i) => i.id === 'playwright').fix, 'npx playwright install chromium');
  assert.match(items.find((i) => i.id === 'ollama').fix, /ollama serve/);
  assert.match(items.find((i) => i.id === 'kokoro').fix, /npm i kokoro-js$/);
  assert.equal(optionalItems({ ...missing, platform: 'darwin' }).find((i) => i.id === 'ffmpeg').fix, 'brew install ffmpeg');
  assert.equal(optionalItems({ ...missing, platform: 'win32' }).find((i) => i.id === 'python3').fix, 'winget install Python.Python.3');
  assert.match(optionalItems(missing, { env: { CONSTRUCT_MEDIA_CACHE: '/opt/media' } }).find((i) => i.id === 'kokoro').fix, /mkdir -p \/opt\/media/);
  const found = optionalItems(await detectMachine(laptop(16, { kokoro: () => true, chatterbox: () => true })));
  assert.ok(found.every((i) => i.fix === undefined && i.found === true));
});

test('a probe that throws is "not found", never a crash; Ollama down is never fatal', async () => {
  const machine = await detectMachine(laptop(16, { ffmpeg: () => { throw new Error('boom'); }, ollama: () => { throw new Error('refused'); }, freeDiskMb: () => { throw new Error('no statfs'); } }));
  assert.equal(machine.tools.ffmpeg, false);
  assert.equal(machine.tools.ollama, false);
  assert.equal(machine.freeDiskMb, null);
  const report = buildMachineReport(machine);
  assert.equal(report.supported, true);
  assert.equal(report.tier.id, 'contributor');
});

test('an unreadable machine or an unsupported Node is not supported (doctor exits 1); everything else is', async () => {
  const noRam = buildMachineReport(await detectMachine(laptop(16, { totalRamMb: () => { throw new Error('no /proc'); } })));
  assert.equal(noRam.supported, false);
  assert.match(noRam.unsupportedReason, /could not be read \(memory\)/);
  const old = buildMachineReport(await detectMachine(laptop(16, { node: () => '18.19.0' })));
  assert.equal(old.supported, false);
  assert.match(old.unsupportedReason, /Node 18\.19\.0 is too old: Construct needs Node 20 or newer/);
  assert.equal(buildMachineReport(await detectMachine(laptop(2))).supported, true, 'below Lite is a report, not a failure');
});

test('the report says what is switched on and off and why, and the text is plain', async () => {
  const report = buildMachineReport(await detectMachine(laptop(4, { ollama: () => false })));
  assert.equal(report.enabled[0].feature, 'Rules-only mode (every command, no model)');
  assert.deepEqual(report.disabled.map((d) => d.feature), ['Model-backed proposals', 'Cockpit', 'Studio voice', 'Playwright proofs']);
  assert.ok(report.notes.some((n) => /never downloads or loads a model|Nothing here downloads or loads a model/.test(n)));
  const text = renderMachineText(report).join('\n');
  assert.match(text, /Tier: Lite/);
  assert.match(text, /Switched off:/);
  assert.match(text, /missing +Ollama/);
  assert.match(text, /fix: install Ollama/);
  assert.doesNotMatch(text, /undefined|NaN|null/);
});

test('low free memory is a warning under "now", kept apart from the stable part of the report', async () => {
  const low = buildMachineReport(await detectMachine(laptop(16, { freeRamMb: () => 1200 })));
  assert.match(low.now.warnings[0], /Only 1\.2 GB of memory is free right now/);
  assert.equal(buildMachineReport(await detectMachine(laptop(16))).now.warnings.length, 0);
});

test('doctor --format json: the old fields are still there, the machine part is added, exit code 0', async () => {
  const dir = makeTempDir('construct-doctor-648-');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  const sink = {};
  try {
    await withExitCodeSink(sink, () => doctor(['--dir', dir, '--format', 'json'], { probes: laptop(16) }));
  } finally {
    console.log = orig;
  }
  const doc = JSON.parse(lines.join('\n'));
  assert.deepEqual(Object.keys(doc).slice(0, 4), ['node', 'npm', 'architectureYml', 'enforcers']);
  assert.equal(doc.architectureYml, false);
  assert.equal(doc.supported, true);
  assert.equal(doc.tier.id, 'contributor');
  assert.equal(doc.machine.cores, 8);
  assert.ok(Array.isArray(doc.enabled) && Array.isArray(doc.disabled) && Array.isArray(doc.optional));
  assert.deepEqual(Object.keys(doc.now), ['freeMemoryMb', 'freeDiskMb', 'warnings']);
  assert.equal(sink.exitCode, undefined, 'exit code stays 0');
  assert.deepEqual(renderDoctorText(doc).slice(0, 2), ['Construct doctor', `node: ${doc.node}`]);
  assert.ok(renderDoctorText(doc).some((l) => l === 'Your machine'));
  assert.equal(renderDoctorText({ node: 'v1', npm: '1', architectureYml: true, enforcers: [] }).length, 5, 'a document from before the machine part still renders');
});

test('doctor exits 1 for an unsupported Node and still prints the report', async () => {
  const dir = makeTempDir('construct-doctor-648-');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  const sink = {};
  try {
    await withExitCodeSink(sink, () => doctor(['--dir', dir], { probes: laptop(16, { node: () => '16.20.0' }) }));
  } finally {
    console.log = orig;
  }
  assert.equal(sink.exitCode, EXIT_CODES.VIOLATIONS);
  assert.ok(lines.some((l) => /Cannot go on: Node 16\.20\.0 is too old/.test(l)));
});

test('no network: the module imports no network module, injected probes never call fetch, and only a loopback address is ever pinged', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'packages/core/machine.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../engine/processStore.mjs', 'node:fs', 'node:os', 'node:path']);
  assert.doesNotMatch(src, /node:(https?|net|dgram|dns|tls)|XMLHttpRequest|WebSocket/);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the network was used'); };
  try {
    const machine = await detectMachine(laptop(16, { ollama: undefined }));
    assert.equal(machine.tools.ollama, false, 'no ollama probe: not found, and no fetch');
    buildMachineReport(machine);
    machineAllowsModels({ probes: laptop(16) });
    assert.equal(await pingLocalOllama('http://127.0.0.1:1'), false, 'a throwing fetch is a "no", not a crash');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(localOllamaUrl({}), 'http://127.0.0.1:11434');
  assert.equal(localOllamaUrl({ OLLAMA_HOST: '127.0.0.1:9999' }), 'http://127.0.0.1:9999');
  assert.equal(localOllamaUrl({ OLLAMA_HOST: 'localhost' }), 'http://localhost:11434');
  assert.equal(localOllamaUrl({ OLLAMA_HOST: 'gpu-box.example.com:11434' }), null, 'another machine is never contacted');
  assert.equal(localOllamaUrl({ OLLAMA_HOST: 'http://10.0.0.5:11434' }), null);
  const probes = defaultProbes({ env: { OLLAMA_HOST: 'gpu-box.example.com' } });
  assert.equal(probes.ollamaUrl(), null);
  assert.equal((await detectMachine({ ...laptop(16), ollamaUrl: probes.ollamaUrl })).tools.ollama, null, 'not checked, not "missing"');
});

test('the Ollama check has a 2 second timeout and answers false on a slow or failing server', async () => {
  let signal;
  const hang = (url, init) => new Promise((_, reject) => {
    signal = init.signal;
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 100); // AbortSignal.timeout's own timer does not keep the process alive; a real socket does
  try {
    assert.equal(await pingLocalOllama('http://127.0.0.1:11434', { timeoutMs: 50, fetchImpl: hang }), false);
  } finally {
    clearInterval(keepAlive);
  }
  assert.ok(Date.now() - started < 1500);
  assert.ok(signal.aborted);
  assert.equal(await pingLocalOllama('http://127.0.0.1:11434', { fetchImpl: async (u) => ({ ok: u.endsWith('/api/tags') }) }), true);
});

test('model files: onnx and gguf under the state folder are counted, a missing folder is zero', () => {
  const dir = makeTempDir('construct-models-648-');
  fs.mkdirSync(path.join(dir, 'models', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'models', 'a', 'x.onnx'), Buffer.alloc(2 * 1048576));
  fs.writeFileSync(path.join(dir, 'models', 'y.GGUF'), Buffer.alloc(1048576));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  assert.deepEqual(countModelFiles(dir), { onnx: 1, gguf: 1, megabytes: 3 });
  assert.deepEqual(countModelFiles(path.join(dir, 'nope')), { onnx: 0, gguf: 0, megabytes: 0 });
});

test('a Lite machine loads no plugin: the rules answer with "rules only: <reason>"; a capable machine behaves as before', async () => {
  const root = makeTempDir('construct-lite-648-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'decision:\n  provider: "jev"\n  plugin: "jev.mjs"\n');
  fs.writeFileSync(path.join(root, 'jev.mjs'), "globalThis.__lite648 = (globalThis.__lite648 ?? 0) + 1;\nexport default { name: 'jev', version: '1', suggest(s) { return { option: s.options[1].id, reason: 'model says so' }; } };\n");
  const summary = { id: 'q', question: 'Which?', options: [{ id: 'a', label: 'A', enabled: true, why: '' }, { id: 'b', label: 'B', enabled: true, why: '' }], chosen: null };
  delete globalThis.__lite648;
  clearDecisionCache();
  const lite = await openDecision(root, { capabilities: { available: false, reason: 'this machine is Lite (4 GB of memory, 2 cores) and loading a model needs 8 GB and 2 cores' } });
  const s = await lite.suggest(summary);
  assert.equal(globalThis.__lite648, undefined, 'the plugin was not imported');
  assert.equal(s.provider, 'rules');
  assert.equal(s.fellBackFrom, 'jev');
  assert.match(lite.notes[0], /^decision: rules only: this machine is Lite/);
  assert.equal(lite.fellBackFrom, 'jev');
  clearDecisionCache();
  const capable = await openDecision(root, { capabilities: { available: true, reason: 'enough' } });
  assert.equal((await capable.suggest(summary)).provider, 'jev');
  assert.equal(globalThis.__lite648, 1);
  delete globalThis.__lite648;
});

test('the default answer comes from this machine only when a plugin is about to load, and an unreadable machine changes nothing', () => {
  assert.equal(machineAllowsModels({ probes: laptop(4) }).available, false);
  assert.equal(machineAllowsModels({ probes: laptop(16) }).available, true);
  const unreadable = machineAllowsModels({ probes: { cores: () => { throw new Error('x'); }, totalRamMb: () => 0 } });
  assert.equal(unreadable.available, true);
  assert.match(unreadable.reason, /could not be read/);
});

test('renderTierTable is one row per tier from TIERS', () => {
  const rows = renderTierTable().split('\n');
  assert.equal(rows.length, 2 + TIER_ORDER.length);
  assert.match(rows[4], /\*\*Contributor\*\* .* \| 4 \| 8 GB workable, 16 GB comfortable \| about 6 GB \|$/);
});
