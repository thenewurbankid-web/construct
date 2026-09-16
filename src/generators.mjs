import path from 'node:path'; import fs from 'node:fs'; import {ensureDir,write,rel} from './fs.mjs'; import {loadConfig} from './config.mjs'; import {validateArchitecture} from './architecture-enforcer.mjs'; import {ConstructError,EXIT_CODES} from './diagnostics.mjs';
// The controller template's own composition (importing a same-named Page
// from the feature's pages/ folder) is Construct's own feature-internal
// convention, not Next.js's -- it works unchanged for either framework.
// What genuinely differs per framework is which file wires the controller
// into the app's actual router in the first place: for nextjs that's a
// physical `app/<route>/page.tsx` (outside the feature entirely -- see
// cli.mjs's init()); for react-spa (#65/#66) it's a `<Route path=...
// element={<XController/>}/>` entry in the centralized src/App.tsx. The
// react-spa template documents that real wiring explicitly instead of
// leaving it an unstated nextjs assumption.
const controllerTemplates={
 nextjs:(n)=>`import { ${n}Page } from '../pages/${n}Page';\n\nexport function ${n}Controller() {\n  return <${n}Page />;\n}\n`,
 'react-spa':(n)=>`import { ${n}Page } from '../pages/${n}Page';\n\n// Registered directly as this route's element by react-router in\n// src/App.tsx (e.g. <Route path="/${n.toLowerCase()}" element={<${n}Controller />} />)\n// -- no per-route page.tsx wrapper file like the Next.js target uses.\nexport function ${n}Controller() {\n  return <${n}Page />;\n}\n`,
};
const templates={
 controller:(n,{framework='nextjs'}={})=>(controllerTemplates[framework]||controllerTemplates.nextjs)(n),
 workflow:(n)=>`import { setup } from 'xstate';\n\nexport const ${n}Workflow = setup({}).createMachine({\n  id: '${n.toLowerCase()}',\n  initial: 'idle',\n  states: { idle: {} }\n});\n`,
 hook:(n)=>`import { useCallback } from 'react';\n\nexport function use${n}() {\n  return { action: useCallback(() => {}, []) };\n}\n`,
 domain:(n)=>`export function ${n}() {\n  return true;\n}\n`,
 service:(n)=>`export async function ${n}() {\n  const response = await fetch('/api/${n.toLowerCase()}', { method: 'GET' });\n  if (!response.ok) throw new Error('Request failed');\n  return response.json();\n}\n`,
 page:(n)=>`import type { ReactNode } from 'react';\n\nexport function ${n}Page(): ReactNode {\n  return <main>${n}</main>;\n}\n`,
 component:(n)=>`export function ${n}() {\n  return <div>${n}</div>;\n}\n`
};
export const folderFor=(layer)=>layer==='hook'?'hooks':layer==='controller'?'controllers':layer==='workflow'?'workflows':layer==='domain'?'domain':layer==='service'?'services':layer==='page'?'pages':'components';

// Shared by generateLayer and refactor.mjs's move/rename: the filename base a
// layer's naming convention expects for a given capitalized name — a hook
// gets a `use` prefix, page/controller get a suffix, everything else is bare.
export const layerFileBaseName=(layer,cap)=>{
 const suffix=layer==='page'?'Page':layer==='controller'?'Controller':'';
 return layer==='hook'?`use${cap}`:`${cap}${suffix}`;
};

// Epic 1.3 — per-layer template override hook. A project may supply a custom
// template for a layer either via architecture.yml's `templates: { <layer>: <path> }`
// or by placing a file named `<layer>.*` under a `templates/` dir at the project
// root. Custom templates are plain text with `{{Name}}` / `{{name}}` / `{{NAME}}`
// placeholders substituted in (no code execution, no new dependency).
function findCustomTemplate(root,layer,config){
 const configured=config?.templates?.[layer];
 if(configured){const p=path.isAbsolute(configured)?configured:path.join(root,configured); if(fs.existsSync(p))return p;}
 const dir=path.join(root,'templates');
 if(fs.existsSync(dir)){const entry=fs.readdirSync(dir).find(f=>f.replace(/\.[^./]+$/,'')===layer); if(entry)return path.join(dir,entry);}
 return null;
}
function renderCustomTemplate(templatePath,name){
 const cap=name[0].toUpperCase()+name.slice(1);
 return fs.readFileSync(templatePath,'utf8').replaceAll('{{Name}}',cap).replaceAll('{{name}}',name).replaceAll('{{NAME}}',name.toUpperCase());
}

// Re-validate freshly generated files against Epic 1.2's enforcer. A failure
// here means Construct's own template produced non-conforming code — an
// internal bug, not a user mistake — so it throws rather than returning a
// normal violation report.
function selfCheck(root,absFiles){
 const files=absFiles.map(f=>rel(root,f));
 const {violations}=validateArchitecture(root,{files});
 const errors=violations.filter(v=>v.severity==='error');
 if(errors.length) throw new ConstructError(
  `Construct generated code that fails its own architecture rules (template bug): ${errors.map(v=>`${v.rule} in ${v.file} — ${v.message}`).join('; ')}`,
  {violations:errors,exitCode:EXIT_CODES.INTERNAL_ERROR}
 );
}

// Feature names are conventionally kebab-case (e.g. "cpo-v2") but a type
// identifier can't contain "-"/"_" — PascalCase across those word
// boundaries the same way `cap` elsewhere assumes a single already-capped
// word, so createFeature's own scaffolded types.ts is always valid TS.
function pascalCase(name){
 return name.replace(/(^|[-_]+)([a-zA-Z0-9])/g,(_,__,c)=>c.toUpperCase());
}

export function createFeature(root,name){
 const config=loadConfig(root);
 const base=path.join(root,config.features?.root||'features',name);
 for(const d of ['controllers','workflows','hooks','domain','services','pages','components'])ensureDir(path.join(base,d));
 const typesFile=path.join(base,'types.ts'), indexFile=path.join(base,'index.ts');
 write(typesFile,`export type ${pascalCase(name)}Id = string;\n`);
 write(indexFile,`// Public API for feature: ${name}\nexport type * from './types';\n`);
 selfCheck(root,[typesFile,indexFile]);
 return base;
}

export function generateLayer(root,layer,name,feature){
 if(!templates[layer])throw new Error(`Unknown layer: ${layer}`);
 const config=loadConfig(root);
 const cap=name[0].toUpperCase()+name.slice(1);
 const dir=path.join(root,config.features?.root||'features',feature,folderFor(layer));
 ensureDir(dir);
 const file=path.join(dir,`${layerFileBaseName(layer,cap)}.tsx`);
 const custom=findCustomTemplate(root,layer,config);
 const content=custom?renderCustomTemplate(custom,name):templates[layer](cap,{framework:config.project?.framework});
 write(file,content);
 selfCheck(root,[file]);
 return file;
}

// Canonical dependency order for a vertical slice: controller's stub template
// imports a same-named page, so page must exist first or IMPORT-001 (a
// dangling relative import) fires — every other layer's stub is
// self-contained. `construct generate layer <name> --layers ...` scaffolds
// one logical unit across several layers in a single command, always in this
// order regardless of the order the caller listed --layers in.
export const LAYER_ORDER=['domain','service','workflow','hook','component','page','controller'];

export function generateVertical(root,name,feature,layers){
 const unique=[...new Set(layers)];
 const unknown=unique.filter(l=>!templates[l]);
 if(unknown.length)throw new Error(`Unknown layer: ${unknown[0]}`);
 const ordered=LAYER_ORDER.filter(l=>unique.includes(l));
 return ordered.map(layer=>generateLayer(root,layer,name,feature));
}
