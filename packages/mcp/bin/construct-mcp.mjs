#!/usr/bin/env node
// construct-mcp (#649): the stdio MCP server. stdout is the protocol channel and nothing else is ever written to it; diagnostics go to stderr.
import fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createConstructMcpServer } from '../src/server.mjs';
import { parseArgs, USAGE } from '../src/cli.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.error) {
  process.stderr.write(`construct-mcp: ${args.error}\n${USAGE}\n`);
  process.exit(2);
}
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (args.version) {
  process.stdout.write(`${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}\n`);
  process.exit(0);
}

let server;
try {
  server = createConstructMcpServer({ root: args.root, ratePerMinute: args.ratePerMinute, maxOutputBytes: args.maxOutputBytes });
} catch (e) {
  process.stderr.write(`construct-mcp: ${e.message}\n`);
  process.exit(2);
}
await server.connect(new StdioServerTransport());
process.stderr.write('construct-mcp: ready on stdio (read-only, plan-only)\n');
