// The typed contract of @line/studio: a command-line package (bin `studio`, bin/studio.mjs -> bin/cli.mjs), not a
// library. Its surface is the `studio` command (start, doctor, --version, --help) and the functions below, typed from
// the modules themselves.

/** `studio [start|doctor] [--port N] [--host H] [--workspace DIR] [--config FILE] [--ollama-url URL]`. */
export { main, parseArgs, HELP, SERVER_FILE, DEFAULT_WORKSPACE_DIR, readVersion } from './bin/cli.mjs';

/** `studio doctor`: checks ffmpeg, ffprobe, Playwright chromium, Ollama and python3, and says how to fix what is missing. */
export {
  runDoctor,
  defaultProbes,
  resolveOllamaUrl,
  findOllamaUrl,
  pingOllama,
  onPath,
  chromiumInstalled,
  mediaCacheDir,
  DEFAULT_OLLAMA_URL,
  MIN_NODE_MAJOR,
} from './bin/doctor.mjs';

/** main()'s result: 0 ok, 1 a failed check or start, 2 a usage error, null while the server keeps running. */
export type StudioExitCode = 0 | 1 | 2 | null;
