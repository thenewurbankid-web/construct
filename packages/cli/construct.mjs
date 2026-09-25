#!/usr/bin/env node
import { getVersion } from './version.mjs';

const [cmd, ...args] = process.argv.slice(2);

// #648: `--version` answers before the engine is loaded (loading it is most of a cold start: about a fifth of a gigabyte
// and over half a second on a small machine), so the cheapest command stays cheap.
if (cmd === '--version' || cmd === '-v') {
  console.log(getVersion());
  process.exit(0);
}

const { init, feature, generate, sync, validate, summarize, doctor, create, refactor, research, review, testCommand, template, importCommand, runImportRouteWizard, pipeline, traces, decide, model } = await import('../core/cli.mjs');
const { EXIT_CODES, ConstructError } = await import('../core/diagnostics.mjs');
const { USAGE } = await import('../core/usage.mjs');

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
  else if (cmd === 'review') await review(args);
  else if (cmd === 'test') await testCommand(args);
  else if (cmd === 'template') await template(args);
  else if (cmd === 'import' && args[0] === '--route') await runImportRouteWizard(args[1]?.startsWith('--') ? undefined : args[1], { planner: args[args.indexOf('--planner') + 1] === 'mechanical' ? 'mechanical' : 'ai' });
  else if (cmd === 'import') await importCommand(args);
  else if (cmd === 'pipeline') await pipeline(args);
  else if (cmd === 'traces') await traces(args);
  else if (cmd === 'decide') await decide(args);
  else if (cmd === 'model') await model(args);
  else if (cmd === 'repl') {
    const { startRepl } = await import('../core/repl.mjs');
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
