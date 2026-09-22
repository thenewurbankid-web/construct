// A stand-in for packages/cli/construct.mjs used by the bot runner tests: it obeys the
// argv planToCommand produces, but does trivial deterministic work so a test
// can script success, failure, a hang, or a model-flag echo.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

if (argv[0] === 'create' && argv[1] === 'feature') {
  const dir = path.join('features', argv[2]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.ts'), `export const ${argv[2]} = true;\n`);
  process.exit(0);
}
if (argv[0] === 'create') {
  const [, layer, name] = argv;
  const file = path.join('features', flag('--feature'), layer, `${name}.ts`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (name === 'Boom') {
    fs.writeFileSync(file, 'half written\n');
    console.error('Boom: could not scaffold');
    process.exit(3);
  }
  if (name === 'Hang') {
    fs.writeFileSync(file, 'half written\n');
    setInterval(() => {}, 1000);
  } else {
    const sawModelEnv = process.env.OLLAMA_HOST ? 'MODEL-ENV' : 'no-model-env';
    fs.writeFileSync(file, `// ${layer} ${name} llm=${flag('--llm')} ${sawModelEnv}\n`);
    process.exit(0);
  }
}
