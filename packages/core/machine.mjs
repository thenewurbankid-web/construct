// #648 -- what this machine can run. Deterministic and read-only: no model, no network (the one local check is a 2 s ping of
// Ollama on THIS machine, never fatal), nothing written. Three parts:
//
//   TIERS + classifyMachine(machine)   the documented tiers (Lite, Cockpit use, Contributor) and which one a machine meets, with the reason
//   capabilities(machine)              pure: which features are on (model-backed proposals, Cockpit, Studio voice, Playwright proofs) and why not
//   detectMachine(probes)              reads the machine through injectable probes (a test hands in a fake machine); `construct doctor` prints it
//
// The tier numbers below are the single source: the "System requirements" page of the site is generated from `TIERS` and a test
// fails when they differ. Peak-memory and time numbers are NOT here: they come from packages/tools/dev/benchmark.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveStateDir } from '../engine/processStore.mjs';

/** The oldest Node major version Construct supports (`engines` in package.json). */
export const MIN_NODE_MAJOR = 20;

/** Where to look for Ollama: this machine only. */
export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/** How long the Ollama check waits before it gives up (milliseconds). Never fatal. */
export const OLLAMA_TIMEOUT_MS = 2000;

/**
 * A machine reports a little less memory than its label (the system keeps some), so a tier's memory need counts as met at this
 * fraction of it: a "16 GB" laptop that shows 15.2 GB still meets 16.
 */
export const RAM_TOLERANCE = 0.9;

/** Free memory (MB) under which a heavy job waits; the same default as `packages/tools/dev/heavy.sh` (CONSTRUCT_MIN_FREE_MB). */
export const LOW_FREE_RAM_MB = 3000;

/**
 * The documented tiers, lowest first. `ramGb`, `cores` and `diskGb` are what the tier needs; `comfortableRamGb` is where the tier
 * stops needing care. The measured process numbers behind them (validate about 311 MB, the two Cockpit processes about 0.5 GB, the
 * install and build sizes) are in the issue and in the benchmark report, not guessed here.
 *
 * @type {Readonly<Record<'lite'|'cockpit'|'contributor', { id: string, name: string, use: string, cores: number, ramGb: number, comfortableRamGb?: number, diskGb: number }>>}
 */
export const TIERS = Object.freeze({
  lite: Object.freeze({ id: 'lite', name: 'Lite', use: 'the command line only: summarize, validate, chains and plans, no Cockpit, no model', cores: 2, ramGb: 4, diskGb: 1 }),
  cockpit: Object.freeze({ id: 'cockpit', name: 'Cockpit use', use: 'the prebuilt Cockpit, or a hosted one used from a browser, on top of the command line', cores: 2, ramGb: 8, diskGb: 2 }),
  contributor: Object.freeze({ id: 'contributor', name: 'Contributor', use: 'building and testing this repository: the full test suite, the Cockpit build, Playwright', cores: 4, ramGb: 8, comfortableRamGb: 16, diskGb: 6 }),
});

/** The tier ids, lowest first. */
export const TIER_ORDER = Object.freeze(['lite', 'cockpit', 'contributor']);

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Megabytes as gigabytes with one decimal, for people: `formatGb(15603) // => '15.2'`.
 *
 * @param {number} mb Megabytes.
 * @returns {string} Gigabytes, one decimal, no unit.
 */
export function formatGb(mb) {
  return String(round1(mb / 1024));
}

/**
 * @typedef {{
 *   platform?: string,
 *   node?: string,
 *   cores?: number,
 *   totalRamMb?: number,
 *   freeRamMb?: number,
 *   freeDiskMb?: number | null,
 *   tools?: { ffmpeg?: boolean, ffprobe?: boolean, playwrightBrowser?: boolean, python3?: boolean, ollama?: boolean | null },
 *   models?: { kokoro?: boolean, chatterbox?: boolean, files?: { onnx: number, gguf: number, megabytes: number } },
 * }} Machine
 * What is known about a machine. Only `cores` and `totalRamMb` are needed to classify it; `freeDiskMb` `null` or absent means unknown
 * (never a shortfall); a missing `tools` or `models` entry counts as not found.
 */

/**
 * What a tier needs that the machine does not have; an empty list means the tier is met. Unknown disk is not a shortfall.
 *
 * @param {(typeof TIERS)[keyof typeof TIERS]} tier One of `TIERS`.
 * @param {Machine} machine The machine.
 * @param {{ ignoreDisk?: boolean }} [options] `ignoreDisk` judges memory and cores only.
 * @returns {{ need: string, have: string }[]} The shortfalls, for example `[{ need: '8 GB of memory', have: '3.7 GB' }]`.
 */
function shortfalls(tier, machine, { ignoreDisk = false } = {}) {
  const out = [];
  if (!(machine.totalRamMb >= tier.ramGb * 1024 * RAM_TOLERANCE)) out.push({ need: `${tier.ramGb} GB of memory`, have: `${formatGb(machine.totalRamMb)} GB` });
  if (!(machine.cores >= tier.cores)) out.push({ need: `${tier.cores} processor cores`, have: String(machine.cores) });
  if (!ignoreDisk && Number.isFinite(machine.freeDiskMb) && machine.freeDiskMb < tier.diskGb * 1024) out.push({ need: `${tier.diskGb} GB of free disk`, have: `${formatGb(machine.freeDiskMb)} GB` });
  return out;
}

/** "8 GB of memory and 4 processor cores (this machine has 3.7 GB and 2)". */
const describeShortfalls = (list) => `${list.map((s) => s.need).join(' and ')} (this machine has ${list.map((s) => s.have).join(' and ')})`;

/**
 * Which documented tier a machine meets: the highest one whose memory, cores and free disk are all there, and why. Below Lite is a
 * tier of its own (`below-lite`): the command line may still run, slowly, and doctor says so instead of failing.
 *
 * @param {Machine} machine The machine (see the `Machine` shape).
 * @returns {{ id: 'lite'|'cockpit'|'contributor'|'below-lite', name: string, comfort: 'comfortable'|'workable'|null, reason: string }} The tier, how comfortable it is (Contributor only: 16 GB comfortable, 8 GB workable one heavy job at a time) and the reason in plain words.
 *
 * @example
 * classifyMachine({ cores: 8, totalRamMb: 16 * 1024, freeDiskMb: 100 * 1024 }).id; // => 'contributor'
 * classifyMachine({ cores: 2, totalRamMb: 4 * 1024 }).name; // => 'Lite'
 */
export function classifyMachine(machine) {
  let met = null;
  for (const id of TIER_ORDER) {
    if (shortfalls(TIERS[id], machine).length === 0) met = TIERS[id];
    else break;
  }
  const have = `${formatGb(machine.totalRamMb)} GB of memory and ${machine.cores} processor core${machine.cores === 1 ? '' : 's'}`;
  if (!met) {
    return { id: 'below-lite', name: 'Below Lite', comfort: null, reason: `Lite needs ${describeShortfalls(shortfalls(TIERS.lite, machine))}. The command line may still run, slowly.` };
  }
  const comfort = met.id === 'contributor' ? (machine.totalRamMb >= met.comfortableRamGb * 1024 * RAM_TOLERANCE ? 'comfortable' : 'workable') : null;
  const next = TIER_ORDER[TIER_ORDER.indexOf(met.id) + 1];
  let reason = `${have} meet ${met.name}`;
  if (met.id === 'contributor') reason += comfort === 'comfortable' ? ` comfortably (${met.comfortableRamGb} GB is comfortable)` : `, but with less than ${met.comfortableRamGb} GB run one heavy job at a time (packages/tools/dev/heavy.sh does that)`;
  else reason += ` (${met.name} is for ${met.use})`;
  reason += '.';
  if (next) reason += ` ${TIERS[next].name} needs ${describeShortfalls(shortfalls(TIERS[next], machine))}.`;
  return { id: met.id, name: met.name, comfort, reason };
}

/**
 * @typedef {{ available: boolean, reason: string }} Capability
 * One feature: whether it is on here and the reason in plain words. When `available` is false the `reason` reads after "rules only:" or "off:".
 */

/**
 * Which features this machine can run, decided by memory, cores and the tools found, never by a model. Pure: the same machine gives the
 * same answer. Every model-backed feature has a rules-only fallback that always works, so `modelProposals.available === false` means
 * "rules only", never "broken", and a model is loaded lazily and only when this says yes (so a Lite machine never downloads or loads one).
 * Disk is judged by `construct doctor`'s tier, not here.
 *
 * @param {Machine} machine The machine (see the `Machine` shape).
 * @returns {{ modelProposals: Capability, cockpit: Capability, studioVoice: Capability, playwrightProofs: Capability }} One entry per feature.
 *
 * @example
 * capabilities({ cores: 2, totalRamMb: 4096 }).modelProposals; // => { available: false, reason: 'this machine is Lite (4 GB of memory, 2 cores) and loading a model needs 8 GB and 2 cores' }
 */
export function capabilities(machine) {
  const t = machine.tools ?? {};
  const m = machine.models ?? {};
  const short = shortfalls(TIERS.cockpit, machine, { ignoreDisk: true });
  const capable = short.length === 0;
  const smallReason = (what) => `this machine is too small for ${what}: it needs ${describeShortfalls(short)}`;
  const modelProposals = capable
    ? { available: true, reason: 'this machine has enough memory and cores to load a model when a project asks for one' }
    : { available: false, reason: `this machine is ${classifyMachine(machine).name} (${formatGb(machine.totalRamMb)} GB of memory, ${machine.cores} core${machine.cores === 1 ? '' : 's'}) and loading a model needs ${TIERS.cockpit.ramGb} GB and ${TIERS.cockpit.cores} cores` };
  const cockpit = capable
    ? { available: true, reason: 'the prebuilt Cockpit (about half a gigabyte for its two processes) fits here' }
    : { available: false, reason: smallReason('the Cockpit') };
  let playwrightProofs;
  if (!capable) playwrightProofs = { available: false, reason: smallReason('a browser') };
  else if (!t.playwrightBrowser) playwrightProofs = { available: false, reason: 'no Playwright browser is installed' };
  else playwrightProofs = { available: true, reason: 'a Playwright browser is installed' };
  let studioVoice;
  if (!capable) studioVoice = { available: false, reason: smallReason('Studio') };
  else if (!t.ffmpeg || !t.ffprobe) studioVoice = { available: false, reason: `${!t.ffmpeg ? 'ffmpeg' : 'ffprobe'} is not installed` };
  else if (!m.kokoro && !(m.chatterbox && t.python3)) studioVoice = { available: false, reason: 'no local voice is installed (Kokoro, or the Chatterbox environment with python3)' };
  else studioVoice = { available: true, reason: `ffmpeg and a local voice (${m.kokoro ? 'Kokoro' : 'Chatterbox'}) are installed` };
  return { modelProposals, cockpit, studioVoice, playwrightProofs };
}

/**
 * The probes `detectMachine` runs, all synchronous except `ollama`. Replace any of them in a test; the defaults read this machine and
 * nothing else (no network beyond a loopback ping of Ollama).
 *
 * @param {{ env?: Record<string, string|undefined>, platform?: string, cwd?: string }} [options] Environment, platform and the project directory whose drive is measured.
 * @returns {Record<string, Function>} `{ platform, node, cores, totalRamMb, freeRamMb, freeDiskMb, ffmpeg, ffprobe, playwrightBrowser, python3, kokoro, chatterbox, modelFiles, ollamaUrl, ollama }`.
 */
export function defaultProbes({ env = process.env, platform = process.platform, cwd = process.cwd() } = {}) {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  const onPath = (bin) => (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean).some((d) => exts.some((e) => fs.existsSync(path.join(d, bin + e))));
  const mediaCache = env.CONSTRUCT_MEDIA_CACHE || path.join(os.homedir(), '.cache', 'construct-media');
  const browsers = env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0'
    ? env.PLAYWRIGHT_BROWSERS_PATH
    : platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : platform === 'win32' ? path.join(env.LOCALAPPDATA || os.homedir(), 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright');
  return {
    platform: () => platform,
    node: () => process.versions.node,
    cores: () => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length),
    totalRamMb: () => Math.round(os.totalmem() / 1048576),
    freeRamMb: () => Math.round(os.freemem() / 1048576),
    freeDiskMb: () => {
      const s = fs.statfsSync(cwd);
      return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576);
    },
    ffmpeg: () => onPath(env.FFMPEG || 'ffmpeg'),
    ffprobe: () => onPath(env.FFPROBE || 'ffprobe'),
    playwrightBrowser: () => fs.readdirSync(browsers).some((n) => /^(chromium|chromium_headless_shell|firefox|webkit)-/.test(n)),
    python3: () => onPath('python3'),
    kokoro: () => fs.existsSync(path.join(mediaCache, 'node_modules', 'kokoro-js')),
    chatterbox: () => fs.existsSync(env.CONSTRUCT_MEDIA_PYTHON || path.join(mediaCache, 'venv', 'bin', 'python')),
    modelFiles: () => countModelFiles(resolveStateDir(env)),
    ollamaUrl: () => localOllamaUrl(env),
    ollama: (url) => pingLocalOllama(url),
  };
}

/**
 * The address to look for Ollama at: `OLLAMA_HOST` when it names this machine (a loopback address), else the default. An address
 * elsewhere is never contacted: doctor makes no network call beyond this machine.
 *
 * @param {Record<string, string|undefined>} [env] Environment.
 * @returns {string | null} A loopback URL, or `null` when `OLLAMA_HOST` points off this machine.
 */
export function localOllamaUrl(env = process.env) {
  if (!env.OLLAMA_HOST) return OLLAMA_DEFAULT_URL;
  try {
    const u = new URL(/^https?:\/\//.test(env.OLLAMA_HOST) ? env.OLLAMA_HOST : `http://${env.OLLAMA_HOST}`);
    return /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(u.hostname) ? u.origin.replace(/:80$/, '') + (u.port ? '' : ':11434') : null;
  } catch {
    return null;
  }
}

/**
 * GET `<url>/api/tags` on this machine with a hard timeout; true when Ollama answers. Never throws.
 *
 * @param {string} url A loopback URL from `localOllamaUrl`.
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [options] Timeout and a fetch to use (tests).
 * @returns {Promise<boolean>} Whether Ollama answered.
 */
export async function pingLocalOllama(url, { timeoutMs = OLLAMA_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(new URL('/api/tags', url).href, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * How many `.onnx` and `.gguf` model files sit under a directory (depth at most 5, at most 5000 entries looked at) and their size.
 * A missing directory is zero files, never an error.
 *
 * @param {string} dir Directory to look in, normally the state directory.
 * @returns {{ onnx: number, gguf: number, megabytes: number }} Counts and total size in megabytes.
 */
export function countModelFiles(dir) {
  const out = { onnx: 0, gguf: 0, megabytes: 0 };
  let seen = 0;
  const walk = (d, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > 5000) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 5) walk(p, depth + 1);
      } else if (e.isFile() && /\.(onnx|gguf)$/i.test(e.name)) {
        out[e.name.toLowerCase().endsWith('.onnx') ? 'onnx' : 'gguf']++;
        try {
          out.megabytes += fs.statSync(p).size / 1048576;
        } catch {
          // a file that vanished is not counted
        }
      }
    }
  };
  walk(dir, 0);
  out.megabytes = Math.round(out.megabytes);
  return out;
}

/**
 * Read the machine through the probes. Each probe may throw or be missing: a failed optional probe is "not found", a failed memory,
 * core or Node probe makes the machine unreadable (`unreadable` lists what could not be read). The Ollama check is the only one that
 * waits (2 s at most), runs only against this machine and never makes the result fail.
 *
 * @param {Record<string, Function>} [probes] Probes, as returned by `defaultProbes`; any may be replaced.
 * @returns {Promise<Machine & { platform: string, node: string | null, unreadable: string[], ollamaUrl: string | null }>} The machine.
 */
export async function detectMachine(probes = defaultProbes()) {
  const unreadable = [];
  const ask = async (name, ...args) => {
    try {
      return await probes[name]?.(...args);
    } catch {
      return undefined;
    }
  };
  const need = async (name) => {
    const v = await ask(name);
    if (!Number.isFinite(v) || v <= 0) unreadable.push(name === 'totalRamMb' ? 'memory' : name);
    return v;
  };
  const node = await ask('node');
  if (typeof node !== 'string') unreadable.push('node');
  const cores = await need('cores');
  const totalRamMb = await need('totalRamMb');
  const freeRamMb = await ask('freeRamMb');
  const freeDiskMb = await ask('freeDiskMb');
  const ollamaUrl = (await ask('ollamaUrl')) ?? null;
  const flag = async (name) => (await ask(name)) === true;
  return {
    platform: (await ask('platform')) ?? process.platform,
    node: typeof node === 'string' ? node : null,
    cores,
    totalRamMb,
    freeRamMb: Number.isFinite(freeRamMb) ? freeRamMb : null,
    freeDiskMb: Number.isFinite(freeDiskMb) ? freeDiskMb : null,
    tools: {
      ffmpeg: await flag('ffmpeg'),
      ffprobe: await flag('ffprobe'),
      playwrightBrowser: await flag('playwrightBrowser'),
      python3: await flag('python3'),
      ollama: ollamaUrl ? (await ask('ollama', ollamaUrl)) === true : null,
    },
    models: {
      kokoro: await flag('kokoro'),
      chatterbox: await flag('chatterbox'),
      files: (await ask('modelFiles')) ?? { onnx: 0, gguf: 0, megabytes: 0 },
    },
    ollamaUrl,
    unreadable,
  };
}

const installFfmpeg = (platform) => (platform === 'darwin' ? 'brew install ffmpeg' : platform === 'win32' ? 'winget install Gyan.FFmpeg' : 'sudo apt install ffmpeg');
const installPython = (platform) => (platform === 'darwin' ? 'brew install python' : platform === 'win32' ? 'winget install Python.Python.3' : 'sudo apt install python3 python3-venv');

/**
 * The optional items doctor checks, each with what it enables and the exact line that fixes it when it is missing.
 *
 * @param {Machine & { ollamaUrl?: string | null }} machine The machine.
 * @param {{ env?: Record<string, string|undefined> }} [options] Environment (for the media cache folder in the fix line).
 * @returns {{ id: string, label: string, found: boolean | null, enables: string, fix?: string }[]} One entry per item; `found: null` means not checked.
 */
export function optionalItems(machine, { env = process.env } = {}) {
  const t = machine.tools ?? {};
  const m = machine.models ?? {};
  const platform = machine.platform ?? process.platform;
  const cache = env.CONSTRUCT_MEDIA_CACHE || '~/.cache/construct-media';
  const item = (id, label, found, enables, fix) => ({ id, label, found, enables, ...(found === false && fix ? { fix } : {}) });
  return [
    item('ffmpeg', 'ffmpeg', Boolean(t.ffmpeg), 'Studio: encodes video and mixes audio', installFfmpeg(platform)),
    item('ffprobe', 'ffprobe', Boolean(t.ffprobe), 'Studio: reads video and audio lengths (comes with ffmpeg)', installFfmpeg(platform)),
    item('playwright', 'Playwright browser', Boolean(t.playwrightBrowser), 'browser proofs of a screen, and Studio recordings', 'npx playwright install chromium'),
    item('ollama', 'Ollama', t.ollama === null || t.ollama === undefined ? null : t.ollama, `a local model server at ${machine.ollamaUrl ?? OLLAMA_DEFAULT_URL} (a 2 second check on this machine only)`, 'install Ollama from https://ollama.com, then run: ollama serve   (and pull a model, for example: ollama pull llama3.2)'),
    item('python3', 'python3', Boolean(t.python3), 'Studio: only for cloning your own voice', installPython(platform)),
    item('kokoro', 'Kokoro voice', Boolean(m.kokoro), 'Studio: the default local narration voice', `mkdir -p ${cache} && cd ${cache} && npm init -y && npm i kokoro-js`),
    item('chatterbox', 'Chatterbox environment', Boolean(m.chatterbox), 'Studio: own-voice narration', 'see docs/MEDIA.md, "Voice cloning" (a Python 3.11 environment in the media cache folder)'),
  ];
}

/**
 * The machine part of a `construct doctor` document: the tier and why, what is switched on and off and why, every optional item with
 * its fix line, and (kept apart because they change from second to second) the free memory and disk right now.
 *
 * @param {Awaited<ReturnType<typeof detectMachine>>} machine From `detectMachine`.
 * @param {{ env?: Record<string, string|undefined> }} [options] Environment.
 * @returns {{ supported: boolean, unsupportedReason: string | null, tier: object, machine: object, enabled: { feature: string, why: string }[], disabled: { feature: string, why: string }[], optional: object[], notes: string[], now: { freeMemoryMb: number | null, freeDiskMb: number | null, warnings: string[] } }} The report. `supported` is false for a Node older than `MIN_NODE_MAJOR` or an unreadable machine (doctor then exits 1).
 */
export function buildMachineReport(machine, { env = process.env } = {}) {
  const major = Number(String(machine.node ?? '').split('.')[0]);
  let unsupportedReason = null;
  if (machine.unreadable?.length) unsupportedReason = `this machine could not be read (${machine.unreadable.join(', ')}), so doctor cannot say what it can run`;
  else if (!(major >= MIN_NODE_MAJOR)) unsupportedReason = `Node ${machine.node} is too old: Construct needs Node ${MIN_NODE_MAJOR} or newer (install it from https://nodejs.org, or with nvm install ${MIN_NODE_MAJOR})`;
  const ok = !machine.unreadable?.length;
  const tier = ok ? classifyMachine(machine) : { id: 'unknown', name: 'Unknown', comfort: null, reason: unsupportedReason };
  const caps = ok ? capabilities(machine) : null;
  const label = { modelProposals: 'Model-backed proposals', cockpit: 'Cockpit', studioVoice: 'Studio voice', playwrightProofs: 'Playwright proofs' };
  const enabled = [{ feature: 'Rules-only mode (every command, no model)', why: 'always on: it needs nothing but Node' }];
  const disabled = [];
  for (const [key, cap] of Object.entries(caps ?? {})) (cap.available ? enabled : disabled).push({ feature: label[key], why: cap.reason });
  const notes = [];
  if (tier.id === 'contributor' && tier.comfort === 'workable') notes.push('Run heavy jobs one at a time: packages/tools/dev/heavy.sh npm test');
  if (tier.id === 'lite' || tier.id === 'below-lite') notes.push('Nothing here downloads or loads a model; every choice is made by the rules.');
  const warnings = [];
  if (Number.isFinite(machine.freeRamMb) && machine.freeRamMb < LOW_FREE_RAM_MB) warnings.push(`Only ${formatGb(machine.freeRamMb)} GB of memory is free right now; a heavy job waits for ${formatGb(LOW_FREE_RAM_MB)} GB (close other programs first).`);
  return {
    supported: unsupportedReason === null,
    unsupportedReason,
    tier,
    machine: { platform: machine.platform, node: machine.node, cores: machine.cores ?? null, totalMemoryMb: machine.totalRamMb ?? null, models: machine.models },
    enabled,
    disabled,
    optional: optionalItems(machine, { env }),
    notes,
    now: { freeMemoryMb: machine.freeRamMb ?? null, freeDiskMb: machine.freeDiskMb ?? null, warnings },
  };
}

/**
 * The lines `construct doctor` prints for the machine part, in plain words. Volatile figures (free memory and disk) are on the lines that start with "Right now".
 *
 * @param {ReturnType<typeof buildMachineReport>} report From `buildMachineReport`.
 * @returns {string[]} Lines, no trailing newline.
 */
export function renderMachineText(report) {
  const lines = ['Your machine'];
  if (report.unsupportedReason) lines.push(`  Cannot go on: ${report.unsupportedReason}`);
  lines.push(`  Tier: ${report.tier.name}${report.tier.comfort ? ` (${report.tier.comfort})` : ''}`, `  Why: ${report.tier.reason}`);
  const m = report.machine;
  if (m.totalMemoryMb) lines.push(`  Found: ${formatGb(m.totalMemoryMb)} GB of memory, ${m.cores} core${m.cores === 1 ? '' : 's'}, Node ${m.node}, ${m.platform}`);
  lines.push(`  Right now: ${report.now.freeMemoryMb === null ? 'free memory unknown' : `${formatGb(report.now.freeMemoryMb)} GB of memory free`}, ${report.now.freeDiskMb === null ? 'free disk unknown' : `${formatGb(report.now.freeDiskMb)} GB of disk free here`}`);
  for (const w of report.now.warnings) lines.push(`  Right now: ${w}`);
  lines.push('Switched on:', ...report.enabled.map((e) => `  ${e.feature}: ${e.why}`));
  if (report.disabled.length) lines.push('Switched off:', ...report.disabled.map((e) => `  ${e.feature}: ${e.why}`));
  lines.push('Optional items:');
  for (const o of report.optional) {
    lines.push(`  ${o.found === null ? 'not checked' : o.found ? 'found      ' : 'missing    '} ${o.label}: ${o.enables}`);
    if (o.fix) lines.push(`              fix: ${o.fix}`);
  }
  const mf = m.models?.files;
  if (mf && mf.onnx + mf.gguf > 0) lines.push(`  Model files in the state folder: ${mf.onnx} onnx, ${mf.gguf} gguf, about ${mf.megabytes} MB`);
  for (const n of report.notes) lines.push(`  Note: ${n}`);
  return lines;
}

/**
 * The tier table of the "System requirements" page, generated from `TIERS` so the page and the code cannot differ. A test fails when
 * the page's copy of this table is not exactly this.
 *
 * @returns {string} A markdown table, no trailing newline.
 *
 * @example
 * renderTierTable().split('\n')[0]; // => '| Tier | For | Cores | Memory | Free disk |'
 */
export function renderTierTable() {
  const rows = TIER_ORDER.map((id) => {
    const t = TIERS[id];
    const mem = t.comfortableRamGb ? `${t.ramGb} GB workable, ${t.comfortableRamGb} GB comfortable` : `${t.ramGb} GB`;
    return `| **${t.name}** | ${t.use} | ${t.cores} | ${mem} | about ${t.diskGb} GB |`;
  });
  return ['| Tier | For | Cores | Memory | Free disk |', '|---|---|---|---|---|', ...rows].join('\n');
}

let cachedHardware = null;

/**
 * Whether this machine may load a model for a decision or suggestion, read once per process and only when asked (a machine that never
 * asks is never probed). Reads memory and cores only. When the machine cannot be read the answer is yes, so behaviour on a machine
 * that cannot be judged is what it was before tiers existed.
 *
 * @param {{ probes?: Record<string, Function>, fresh?: boolean }} [options] Probes to use (tests) and `fresh` to skip the per-process cache.
 * @returns {Capability} `{ available, reason }`; `reason` reads after "rules only:" when `available` is false.
 */
export function machineAllowsModels({ probes, fresh = false } = {}) {
  if (!fresh && !probes && cachedHardware) return cachedHardware;
  let answer;
  try {
    const p = probes ?? defaultProbes();
    const machine = { cores: p.cores(), totalRamMb: p.totalRamMb() };
    answer = Number.isFinite(machine.cores) && Number.isFinite(machine.totalRamMb) ? capabilities(machine).modelProposals : { available: true, reason: 'this machine could not be read, so nothing is switched off' };
  } catch {
    answer = { available: true, reason: 'this machine could not be read, so nothing is switched off' };
  }
  if (!probes) cachedHardware = answer;
  return answer;
}
