// Shared helpers of the @line/construct-mcp tests (#649). Lives outside test/ on purpose: `node --test` treats every .mjs file under
// a directory named test as a test file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createConstructMcpServer } from '../src/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The repository root of this checkout. */
export const REPO = path.resolve(HERE, '..', '..', '..');
/** The server's executable. */
export const BIN = path.join(HERE, '..', 'bin', 'construct-mcp.mjs');
const CONSTRUCT = path.join(REPO, 'packages', 'cli', 'construct.mjs');

/**
 * A fresh `construct init` project in a temp directory (react-spa, so no Next.js needed), the way other tests make one.
 *
 * @param {{ framework?: string, files?: Record<string, string> }} [options] The framework and extra files to write (project-relative path to text).
 * @returns {string} The real path of the project.
 */
export function makeProject({ framework = 'react-spa', files = {} } = {}) {
  const dir = makeTempDir('construct-mcp-');
  const r = spawnSync(process.execPath, [CONSTRUCT, 'init', '--framework', framework], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`construct init failed: ${r.stderr}`);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

/**
 * A digest of a whole directory tree: every path, its kind, its bytes (or its link target). Two equal digests mean a byte-identical tree.
 *
 * @param {string} dir The directory.
 * @returns {string} A sha256 hex digest.
 */
export function hashTree(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isSymbolicLink()) h.update(`L ${rel} -> ${fs.readlinkSync(p)}\n`);
      else if (e.isDirectory()) {
        h.update(`D ${rel}\n`);
        walk(p);
      } else {
        h.update(`F ${rel} ${fs.statSync(p).mode & 0o777}\n`);
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

/**
 * Connect an SDK client to a server built in this process, over the SDK's in-memory transport.
 *
 * @param {Parameters<typeof createConstructMcpServer>[0]} options The server options.
 * @param {string} [clientName] The client's name (what `by: 'llm'` attribution carries).
 * @returns {Promise<{ client: Client, server: any, close: () => Promise<void> }>} The connected pair.
 */
export async function connectInProcess(options, clientName = 'test-client') {
  const server = createConstructMcpServer(options);
  const client = new Client({ name: clientName, version: '0.0.1' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { client, server, close: async () => { await client.close(); await server.close(); } };
}

/**
 * Spawn the real executable and connect an SDK client to it over stdio.
 *
 * @param {string[]} args The arguments after the script name.
 * @param {Record<string, string>} [env] Extra environment.
 * @returns {Promise<{ client: Client, transport: any, stderr: () => string, close: () => Promise<void> }>} The connected client.
 */
export async function connectStdio(args, env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, ...args], env: { ...process.env, ...env }, stderr: 'pipe' });
  let err = '';
  const client = new Client({ name: 'test-stdio-client', version: '0.0.1' });
  await client.connect(transport);
  transport.stderr?.on('data', (d) => { err += d; });
  return { client, transport, stderr: () => err, close: () => client.close() };
}

/**
 * Call a tool and parse its JSON text.
 *
 * @param {Client} client The connected client.
 * @param {string} name The tool.
 * @param {object} [args] Its arguments.
 * @returns {Promise<{ isError: boolean, body: any, text: string }>} The parsed result.
 */
export async function callTool(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  return { isError: r.isError === true, text, body: JSON.parse(text) };
}
