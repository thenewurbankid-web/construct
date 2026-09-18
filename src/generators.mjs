import path from 'node:path'; import fs from 'node:fs'; import {ensureDir,write,rel} from './fs.mjs'; import {loadConfig} from './config.mjs'; import {validateArchitecture} from './architecture-enforcer.mjs'; import {ConstructError,EXIT_CODES} from './diagnostics.mjs'; import {requestFileText} from './llm-fill.mjs';
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

// Reverse of folderFor — which layer a generated file's own parent folder
// name implies. Single source of truth shared by import.mjs's per-file
// fill (porting) and this module's own fillGeneratedFile (scaffolding-from-
// scratch, #101) so both ever call an LLM with exactly the same
// layer-constraint text for a given file, never two copies that could
// drift apart.
export const FOLDER_TO_LAYER={controllers:'controller',workflows:'workflow',hooks:'hook',domain:'domain',services:'service',pages:'page',components:'component'};
export const layerFromGeneratedFile=(file)=>FOLDER_TO_LAYER[path.basename(path.dirname(file))]||'component';

// The rule each layer's generated file must keep obeying, whether a human,
// import's fill, or this module's own create/generate fill writes its real
// body — handed verbatim to whichever LLM does that writing, in its
// prompt, so the constraint is an example the model sees rather than
// something enforced only after the fact by construct validate.
export const LAYER_CONSTRAINTS={
 domain:'Pure function(s) only. Never write the words fetch, window, document, localStorage, sessionStorage, or navigator anywhere in the file, even in a comment. No React import.',
 service:'Owns an external effect on behalf of the feature. Never import React or any react-related package.',
 workflow:'A state machine (e.g. via xstate\'s setup/createMachine). Never import "react" or any package path containing "react/".',
 hook:'A React hook — the exported function name must start with "use". May import anything.',
 component:'Presentation-only, from props. Never write the substring "controllers/", "workflows/", "services/", or "domain/" anywhere in the file, even in a comment.',
 page:'Presentation composition from props only. Never write "workflows/", "services/", or "domain/" anywhere in the file (even in a comment), never call fetch(), never use useMachine/useActor/createMachine.',
 controller:'Composes hooks/domain/pages for a route. No import restrictions.',
};

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
// normal violation report. Exported so other generators (e.g. Ticket 7.2's
// pageTransformer.mjs, ingesting an externally-authored JSX file) reuse the
// same re-validate-after-write step instead of a second copy of it.
export function selfCheck(root,absFiles){
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
//
// #24 handled the "-"/"_" boundaries themselves; #79 closed the gap that
// left: any character the boundary-replace doesn't touch (a leading digit,
// a space, anything outside [-_a-zA-Z0-9]) passed straight through into the
// result untouched, so a feature name like "3d-viewer" silently produced
// "3dViewer" -- a syntactically invalid `export type 3dViewerId` in the
// scaffolded types.ts. Reject that at scaffold time instead of writing it.
const TS_IDENTIFIER_RE=/^[A-Za-z_$][A-Za-z0-9_$]*$/;
function pascalCase(name){
 const result=name.replace(/(^|[-_]+)([a-zA-Z0-9])/g,(_,__,c)=>c.toUpperCase());
 if(!TS_IDENTIFIER_RE.test(result)) throw new ConstructError(
  `Feature name "${name}" can't be turned into a valid TypeScript identifier (got "${result}") — identifiers can't start with a digit and can only contain letters, digits, "_", and "$". Rename the feature.`,
  {exitCode:EXIT_CODES.USAGE_ERROR}
 );
 return result;
}

export function createFeature(root,name){
 // Validate before any side effect: an illegal-identifier name (#79) must
 // fail clearly with nothing written, not leave a half-scaffolded feature
 // directory behind it.
 const capName=pascalCase(name);
 const config=loadConfig(root);
 const base=path.join(root,config.features?.root||'features',name);
 for(const d of ['controllers','workflows','hooks','domain','services','pages','components'])ensureDir(path.join(base,d));
 const typesFile=path.join(base,'types.ts'), indexFile=path.join(base,'index.ts');
 write(typesFile,`export type ${capName}Id = string;\n`);
 write(indexFile,`// Public API for feature: ${name}\nexport type * from './types';\n`);
 selfCheck(root,[typesFile,indexFile]);
 return base;
}

// Pure: compute the {file, content} a layer's template would produce,
// without touching disk. Shared by generateLayer (below, unchanged disk-
// writing behavior) and the Ticket 7.1 pipeline runner (src/engine/pipeline.mjs),
// which stages the same content into a transactionalWriter buffer instead of
// writing it directly -- so template logic lives in exactly one place either way.
export function renderLayer(root,layer,name,feature){
 if(!templates[layer])throw new Error(`Unknown layer: ${layer}`);
 const config=loadConfig(root);
 const cap=name[0].toUpperCase()+name.slice(1);
 const dir=path.join(root,config.features?.root||'features',feature,folderFor(layer));
 const file=path.join(dir,`${layerFileBaseName(layer,cap)}.tsx`);
 const custom=findCustomTemplate(root,layer,config);
 const content=custom?renderCustomTemplate(custom,name):templates[layer](cap,{framework:config.project?.framework});
 return {file,content};
}

export function generateLayer(root,layer,name,feature){
 const {file,content}=renderLayer(root,layer,name,feature);
 write(file,content); // write() ensures the parent dir exists
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

// `onLayer` (optional, #165) is called once per layer immediately after it
// finishes, with `{ layer, file, elapsedSeconds }` -- the only way to get
// genuine per-layer scaffold timing for cli.mjs's `generate layer` console
// output without duplicating this function's unknown-layer validation /
// dependency-ordering elsewhere (which would risk writing some layers
// before discovering a later one is invalid -- a real behavior change).
// Omitting it is a no-op: every existing caller (import.mjs's
// importVertical, every test) is unaffected.
export function generateVertical(root,name,feature,layers,{onLayer}={}){
 const unique=[...new Set(layers)];
 const unknown=unique.filter(l=>!templates[l]);
 if(unknown.length)throw new Error(`Unknown layer: ${unknown[0]}`);
 const ordered=LAYER_ORDER.filter(l=>unique.includes(l));
 return ordered.map(layer=>{
  const start=process.hrtime.bigint();
  const file=generateLayer(root,layer,name,feature);
  if(onLayer)onLayer({layer,file,elapsedSeconds:Number(process.hrtime.bigint()-start)/1e9});
  return file;
 });
}

// ---- optional LLM fill for a freshly-scaffolded file (#101/Epic 6.5) -----
//
// Mirrors import.mjs's per-file fill exactly in shape (one call per file,
// layer constraint in the prompt, keep the stub's exported identifier
// name, strip code fences from the response) but writes a real
// implementation from scratch rather than porting one from an old source
// file — there is no "old file" here, only the template stub itself and a
// plain description of what it's for (feature + name + layer). Scoped
// strictly to one already-generated file's own body: this function never
// decides which layers/files exist — cli.mjs's generate()/create() call
// generateLayer/generateVertical first, exactly as before, and only then
// optionally call this once per resulting file.
function buildScaffoldFillPrompt({layer,relFile,stubContent,name,feature}){
 return [
  'You are implementing one freshly-scaffolded file of a Construct-architecture project, from scratch (there is no prior/legacy source to port — write a real, working implementation).',
  `Target file: ${relFile} (layer: "${layer}", feature: "${feature}").`,
  `Layer constraint: ${LAYER_CONSTRAINTS[layer]||'none.'}`,
  `Keep the exact exported identifier name(s) already present in the current stub below unchanged — replace only the body with a real, reasonable implementation appropriate for something named "${name}" at this layer. Do not invent unrelated behavior or additional exports.`,
  '',
  '=== CURRENT STUB (this is the file you are rewriting) ===',
  stubContent,
  '',
  'Return ONLY the new, complete file content. No markdown code fences, no explanation, no commentary — just the raw file content that will be written as-is.',
 ].join('\n');
}

/** Overwrite one already-generated file's stub content with `llm`'s real
 * implementation. `root` is only used to build the file's prompt-relative
 * path (for the same reason import.mjs's fill does — a clearer prompt, not
 * a behavior difference); `file` must already exist (i.e. call this after
 * generateLayer/generateVertical, never instead of it). `llmOptions` is
 * passed straight through to callLlm — see llm.mjs's ollama provider for
 * what it can carry (model/baseUrl). Returns
 * `{ file, status: 'filled'|'rejected'|'failed', reason?, attempts }` —
 * see llm-fill.mjs; anything but 'filled' leaves the stub untouched. */
export async function fillGeneratedFile(root,file,layer,{feature,name,llm,llmOptions}={}){
 const stubContent=fs.readFileSync(file,'utf8');
 const prompt=buildScaffoldFillPrompt({layer,relFile:rel(root,file),stubContent,name,feature});
 // Never write a response that isn't valid code (#144): on rejection or a
 // failed provider call the scaffolded stub stays exactly as generated.
 const outcome=await requestFileText(llm,prompt,llmOptions);
 if(outcome.status==='filled') write(file,outcome.code);
 const {code:_code,...rest}=outcome;
 return {file,...rest};
}
