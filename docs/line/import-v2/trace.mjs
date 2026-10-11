import path from 'node:path';
import fs from 'node:fs';
const rr = await import('/Users/shashank/Repositories/construct/packages/core/route-resolver.mjs');
const app = process.env.HOME + '/Repositories/max-ai-ui';
const { aliases } = rr.readPathAliases(app);
const entry = path.join(app, 'src/app/[locale]/(with-max-topbar)/(with-sidebar)/(with-default-scroll)/opportunity/page.tsx');
const files = rr.traceRouteFiles(entry, { aliases });
const rel = files.map((f) => path.relative(app, f));
const byDir = {};
let lines = 0;
for (const f of files) { const n = fs.readFileSync(f, 'utf8').split('\n').length; lines += n; const d = path.relative(app, path.dirname(f)).split('/').slice(0, 3).join('/'); byDir[d] = (byDir[d] || 0) + 1; }
console.log('files', files.length, 'lines', lines);
console.log(Object.entries(byDir).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([d, n]) => `${n}\t${d}`).join('\n'));
fs.writeFileSync(process.argv[2], rel.join('\n'));
