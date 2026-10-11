// A stand-in for @line/studio (LINE-MODULE (b)): main() and runDoctor() with the real signatures and result shapes
// (contract.d.ts), and nothing started or probed. A caller that launches Studio or reads its doctor report is tested
// with it; test/mock.test.mjs keeps the names and shapes in step with bin/cli.mjs and bin/doctor.mjs.

// The doctor's constants are plain values (bin/doctor.mjs loads only node built-ins): the mock shares the real ones.
export { DEFAULT_OLLAMA_URL, MIN_NODE_MAJOR } from './bin/doctor.mjs';

export const DEFAULT_WORKSPACE_DIR = 'studio-workspace';
export const readVersion = () => '0.0.0-mock';

/**
 * @typedef {{ id: string, label: string, required: boolean, ok: boolean, detail: string, fix?: string }} DoctorResult
 */

/**
 * Every check passes (or the ids in `missing` fail), without probing the machine.
 * @param {{ missing?: string[] }} [opts] Check ids to report missing.
 * @returns {Promise<{ results: DoctorResult[], lines: string[], exitCode: 0 | 1 }>} The report.
 */
export async function runDoctor({ missing = [] } = {}) {
  const ids = [['node', true], ['ffmpeg', true], ['ffprobe', true], ['chromium', true], ['ollama', false], ['kokoro', false], ['python', false]];
  const results = ids.map(([id, required]) => ({ id, label: id, required, ok: !missing.includes(id), detail: 'mock', fix: missing.includes(id) ? `install ${id}` : undefined }));
  const lines = results.map((r) => `${r.ok ? 'ok      ' : r.required ? 'MISSING ' : 'optional'} ${r.label}: ${r.detail}`);
  const failed = results.filter((r) => !r.ok && r.required);
  lines.push(failed.length ? `${failed.length} required item(s) missing: ${failed.map((r) => r.label).join(', ')}` : 'ready');
  return { results, lines, exitCode: failed.length ? 1 : 0 };
}

/**
 * The `studio` command without a server: --version and --help answer, `doctor` runs the mock doctor, `start`
 * returns null (the real one keeps the process alive), anything else is a usage error (2).
 * @param {string[]} argv Arguments after `studio`.
 * @param {{ out?: (s: string) => void, err?: (s: string) => void }} [io] Line writers.
 * @returns {Promise<0 | 1 | 2 | null>} The exit code.
 */
export async function main(argv, { out = () => {}, err = () => {} } = {}) {
  const [cmd = 'start'] = argv;
  if (cmd === '--version' || cmd === '-v') { out(readVersion()); return 0; }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { out('studio (mock)'); return 0; }
  if (cmd === 'doctor') { const r = await runDoctor(); r.lines.forEach((l) => out(l)); return r.exitCode; }
  if (cmd === 'start') return null;
  err(`studio: unknown command "${cmd}" (see studio --help)`);
  return 2;
}
