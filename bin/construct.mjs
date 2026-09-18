#!/usr/bin/env node
import { init, feature, generate, sync, validate, summarize, doctor, create, refactor, research, importCommand, runImportRouteWizard, pipeline } from '../src/cli.mjs';
import { startRepl } from '../src/repl.mjs';
import { EXIT_CODES, ConstructError } from '../src/diagnostics.mjs';
import { USAGE } from '../src/usage.mjs';

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'init') await init(args);
  else if (cmd === 'feature') await feature(args);
  else if (cmd === 'generate' || cmd === 'g') await generate(args);
  else if (cmd === 'sync') await sync(args);
  else if (cmd === 'validate') await validate(args);
  else if (cmd === 'summarize') await summarize(args);
  else if (cmd === 'doctor') await doctor(args);
  else if (cmd === 'create') await create(args);
  else if (cmd === 'refactor') await refactor(args);
  else if (cmd === 'research') await research(args);
  else if (cmd === 'import' && args[0] === '--route') await runImportRouteWizard(args[1]);
  else if (cmd === 'import') await importCommand(args);
  else if (cmd === 'pipeline') await pipeline(args);
  else if (cmd === 'repl') {
    await startRepl();
    process.exit(0);
  } else {
    console.log(USAGE);
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
  process.exit(process.exitCode ?? EXIT_CODES.OK);
} catch (e) {
  console.error(`\nConstruct error: ${e.message}`);
  process.exit(e instanceof ConstructError ? e.exitCode : EXIT_CODES.INTERNAL_ERROR);
}
