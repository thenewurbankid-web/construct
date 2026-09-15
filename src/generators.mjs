import path from 'node:path'; import fs from 'node:fs'; import {ensureDir,write,rel} from './fs.mjs'; import {loadConfig} from './config.mjs'; import {validateArchitecture} from './architecture-enforcer.mjs'; import {ConstructError,EXIT_CODES} from './diagnostics.mjs';
const templates={
 controller:(n)=>`import { ${n}Page } from '../pages/${n}Page';\n\nexport function ${n}Controller() {\n  return <${n}Page />;\n}\n`,
 workflow:(n)=>`import { setup } from 'xstate';\n\nexport const ${n}Workflow = setup({}).createMachine({\n  id: '${n.toLowerCase()}',\n  initial: 'idle',\n  states: { idle: {} }\n});\n`,
 hook:(n)=>`import { useCallback } from 'react';\n\nexport function use${n}() {\n  return { action: useCallback(() => {}, []) };\n}\n`,
 domain:(n)=>`export function ${n}() {\n  return true;\n}\n`,
 service:(n)=>`export async function ${n}() {\n  const response = await fetch('/api/${n.toLowerCase()}', { method: 'GET' });\n  if (!response.ok) throw new Error('Request failed');\n  return response.json();\n}\n`,
 page:(n)=>`import type { ReactNode } from 'react';\n\nexport function ${n}Page(): ReactNode {\n  return <main>${n}</main>;\n}\n`,
 component:(n)=>`export function ${n}() {\n  return <div>${n}</div>;\n}\n`
};
const folderFor=(layer)=>layer==='hook'?'hooks':layer==='controller'?'controllers':layer==='workflow'?'workflows':layer==='domain'?'domain':layer==='service'?'services':layer==='page'?'pages':'components';

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

export function createFeature(root,name){
 const base=path.join(root,'features',name);
 for(const d of ['controllers','workflows','hooks','domain','services','pages','components'])ensureDir(path.join(base,d));
 const typesFile=path.join(base,'types.ts'), indexFile=path.join(base,'index.ts');
 write(typesFile,`export type ${name[0].toUpperCase()+name.slice(1)}Id = string;\n`);
 write(indexFile,`// Public API for feature: ${name}\nexport type * from './types';\n`);
 selfCheck(root,[typesFile,indexFile]);
 return base;
}

export function generateLayer(root,layer,name,feature){
 if(!templates[layer])throw new Error(`Unknown layer: ${layer}`);
 const config=loadConfig(root);
 const cap=name[0].toUpperCase()+name.slice(1);
 const dir=path.join(root,'features',feature,folderFor(layer));
 ensureDir(dir);
 const file=path.join(dir,layer==='hook'?`use${cap}.tsx`:`${cap}${layer==='page'?'Page':''}.tsx`);
 const custom=findCustomTemplate(root,layer,config);
 const content=custom?renderCustomTemplate(custom,name):templates[layer](cap);
 write(file,content);
 selfCheck(root,[file]);
 return file;
}
