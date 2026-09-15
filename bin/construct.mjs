#!/usr/bin/env node
import { init, feature, generate, sync, validate, summarize, doctor } from '../src/cli.mjs';
import { EXIT_CODES, ConstructError } from '../src/diagnostics.mjs';

const [cmd, ...args] = process.argv.slice(2);

const USAGE = `Construct\n\nCommands:\n  construct init [dir]\n  construct feature create <name>\n  construct generate <layer> <name> --feature <feature>\n  construct sync\n  construct validate [--format json]\n  construct summarize [--feature <name>] [--format json|md|compact] [--since <ref>]\n  construct doctor`;

try {
  if (cmd === 'init') await init(args);
  else if (cmd === 'feature') await feature(args);
  else if (cmd === 'generate' || cmd === 'g') await generate(args);
  else if (cmd === 'sync') await sync(args);
  else if (cmd === 'validate') await validate(args);
  else if (cmd === 'summarize') await summarize(args);
  else if (cmd === 'doctor') await doctor(args);
  else {
    console.log(USAGE);
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
  process.exit(process.exitCode ?? EXIT_CODES.OK);
} catch (e) {
  console.error(`\nConstruct error: ${e.message}`);
  process.exit(e instanceof ConstructError ? e.exitCode : EXIT_CODES.INTERNAL_ERROR);
}
