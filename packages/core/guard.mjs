// #629 (part of epic #616) -- the route guard: choose who may open a screen from a short list, and the block writes the guard and wires it to the route.
// A deterministic block with no model: fixed templates, the same request writes the same bytes, and running it twice changes nothing.
//
//   construct create guard Products --feature shop --access signed-in
//   construct create guard Reports --feature shop --access role --roles admin,manager [--redirect /sign-in] [--route /reports]
//
//   guardArgIssue(args)               first reason a `guard.route` request is invalid (pure; plan.mjs uses it), or null
//   guardFiles(root, request)         pure: the files the guard writes, `{ path, content, layer }` (absolute paths)
//   guardTouches(root, request)       the same as a plan step's `touches.files`, plus what it modifies (types, barrel, route entry) and its proof
//   generateGuard(root, request)      write it: the units, the proof, and the edit of the route entry; idempotent; refuses, with the reason, and writes nothing
//   guardRouteSource(source, options) the pure edit of a route entry (testable alone)
//   accessOffer(root, request)        the closed question `q-access` (public | signed-in | role) with the rules default read off the requirement card
//
// The three accesses. `public` writes nothing (a documented no-op: the screen is open to everyone, which is what a route is without a guard).
// `signed-in` and `role` write a small typed slice of the feature:
//   domain      <Name>Access.domain.ts      decide<Name>Access({ session }) -> Access, pure: allowed, signed-out or wrong-role (role: signed in AND holding one of the roles)
//   hook        useSession.hook.ts          who is signed in: a React context that is SIGNED OUT until a provider above the screen supplies a session, so a screen
//                                           nobody wired is closed, never open by accident; or, when the project already has a session provider unit
//                                           (defineProvider whose value is a Session), use<Name>Session.hook.ts reads it
//   component   <Name>Fallback.component.tsx the typed fallback: a "not allowed" notice (role alert), with a link to --redirect when one is given
//   expression  <Name>ByAccess.expression.tsx shows what it wraps only when access is allowed, else the fallback: the screen is never rendered for anyone else
//   controller  <Name>GuardController.controller.tsx reads the session, decides, and wraps its children
// The route entry (Next.js app/<route>/page.tsx, react-spa src/App.tsx) is edited to render `<XGuardController><XController /></XGuardController>`: a route may import
// only controllers, and because the guarded screen is a child element it is not rendered (its data hooks never run) for a person who is not allowed.
// The proof (`<Name>Guard.proof.test.ts`, locked) renders signed-out, wrong-role and allowed and shows that only the fallback, or only the screen, is on the page.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { selfCheck } from './generators.mjs';
import { write } from './fs.mjs';
import { syncPublicApi } from './api-composer.mjs';
import { providersOf } from './provider-wrap.mjs';
import { routeEntryFile, routePathOf } from './wiring.mjs';
import { assertFeature, featureDirOf, withDeclarations, writeOwned } from './block-kit.mjs';
import { GUARD_ACCESS, MAX_ROLES, ROLE_RE, guardArgIssue, rolesOf } from './block-args.mjs';
import { EXPECT_LINES, blockProofTouches, proofHeader, writeBlockProof } from './block-proof.mjs';
import { importLine, lines, words } from './shape-kit.mjs';
import { lit } from '../engine/testSpecRender.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export { GUARD_ACCESS, MAX_ROLES, ROLE_RE, guardArgIssue, rolesOf };

/** The id of the closed question about who may open a screen (chooser summary shape, like `q-route`); several screens get `q-access-<kebab-name>`. */
export const ACCESS_QUESTION_ID = 'q-access';

const ROUTE_RE = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

// ------------------------------------------------------------------------------------------------------------------ names

const SESSION_TYPE = {
  declares: 'Session',
  marker: "'signed-in'",
  text: lines('/** Who is looking at a screen: nobody signed in, or a signed-in person with the roles they hold. */', 'export type Session =', "  | { status: 'signed-out' }", "  | { status: 'signed-in'; userId: string; roles: string[] };"),
};
const ACCESS_TYPE = {
  declares: 'Access',
  marker: "'wrong-role'",
  text: lines('/** What a guard decides about a screen: let the person in, or show the fallback and say why. */', 'export type Access =', "  | { status: 'allowed' }", "  | { status: 'signed-out' }", "  | { status: 'wrong-role'; needs: string[] };"),
};

const namesOf = (Name) => ({
  Name, decide: `decide${Name}Access`, domain: `${Name}Access`, fallback: `${Name}Fallback`, fallbackProps: `${Name}FallbackProps`, expression: `${Name}ByAccess`, expressionProps: `${Name}ByAccessProps`,
  controller: `${Name}GuardController`, controllerProps: `${Name}GuardProps`, controllerName: `${Name}Controller`, sessionHook: `use${Name}Session`, label: words(Name).join(' ').toLowerCase(),
});

/** The text of a source file with the JSX element of a controller written in one of its two forms found; used by the route edit. */
const elementRe = (ident) => new RegExp(`<${escapeRe(ident)}\\s*/>`, 'g');

const frameworkOf = (root) => loadConfig(root).project?.framework ?? 'nextjs';

/**
 * The session source a guard reads: the project's own session provider when it has one (a `defineProvider` unit named like a session, an auth or a user whose value is
 * a `Session`, reachable from this feature), else the small typed hook this block writes (a context that is signed out until something supplies a session).
 *
 * @param {string} root Project root.
 * @param {string} feature The feature the guard goes in.
 * @returns {{ kind: 'provider', hook: string, spec: string, id: string } | { kind: 'stub' }} What the guard's session hook reads.
 *
 * @example
 * sessionSourceOf(root, 'shop'); // => { kind: 'stub' }
 */
export function sessionSourceOf(root, feature) {
  try {
    const found = providersOf(root, { feature }).filter((p) => p.usable && /(?:session|auth|user)/i.test(p.hook)).find((p) => {
      const source = fs.readFileSync(path.join(root, p.file), 'utf8');
      return /defineProvider\s*<[^>]*,\s*Session\s*>/.test(source);
    });
    if (!found) return { kind: 'stub' };
    const hooks = path.join(featureDirOf(root, feature), 'hooks');
    const target = found.feature === feature ? path.join(root, found.file) : path.join(featureDirOf(root, found.feature), 'index');
    const spec = path.relative(hooks, target.replace(/\.(?:tsx?|jsx?)$/, '')).split(path.sep).join('/');
    return { kind: 'provider', hook: found.hook, spec: spec.startsWith('.') ? spec : `./${spec}`, id: found.id };
  } catch {
    return { kind: 'stub' };
  }
}

// -------------------------------------------------------------------------------------------------------------- templates

function domainText(n, request) {
  const roles = rolesOf(request.roles);
  const role = request.access === 'role';
  const what = role ? `signed out gets the fallback, a signed-in person needs one of the roles ${roles.join(', ')}` : 'signed out gets the fallback, anyone signed in is allowed';
  return lines(
    importLine('defineDomain'), "import type { Access, Session } from '../types';", '',
    `/** Decides who may open the ${n.label} screen: ${what}. Pure: the same session gives the same answer. */`,
    `export const ${n.decide} = defineDomain<{ session: Session }, Access>('${n.decide}', ({ session }) => {`,
    "  if (session.status === 'signed-out') return { status: 'signed-out' };",
    ...(role ? [`  const needs = [${roles.map((r) => `'${r}'`).join(', ')}];`, '  const held = needs.filter((wanted) => session.roles.includes(wanted));', "  if (held.length === 0) return { status: 'wrong-role', needs };"] : []),
    "  return { status: 'allowed' };", '});',
  );
}

function fallbackText(n, request) {
  const roles = rolesOf(request.roles);
  const wrong = request.access === 'role' ? `You need one of these roles to open the ${n.label} screen: ${roles.join(', ')}.` : `You do not have access to the ${n.label} screen.`;
  const link = request.redirect ? [`    {' '}`, `    <a href="${request.redirect}">Go to ${request.redirect}</a>`] : [];
  return lines(
    importLine('defineComponent'), "import type { Access } from '../types';", '',
    `export interface ${n.fallbackProps} {`, "  access: Exclude<Access, { status: 'allowed' }>;", '}', '',
    'const TEXT: Record<\'signed-out\' | \'wrong-role\', string> = {', `  'signed-out': 'Sign in to open the ${n.label} screen.',`, `  'wrong-role': '${wrong}',`, '};', '',
    `/** The notice a person sees in place of the ${n.label} screen when the guard does not let them in${request.redirect ? `, with a link to ${request.redirect}` : ''}. */`,
    `export const ${n.fallback} = defineComponent<${n.fallbackProps}>('${n.fallback}', ({ access }) => (`,
    ...(link.length ? ['  <p role="alert">', '    {TEXT[access.status]}', ...link, '  </p>'] : ['  <p role="alert">{TEXT[access.status]}</p>']), '));',
  );
}

function expressionText(n) {
  return lines(
    importLine('defineExpression'), `import { ${n.fallback} } from '../components/${n.fallback}.component';`, "import type { Access } from '../types';", '',
    `export interface ${n.expressionProps} {`, '  access: Access;', '}', '',
    `/** Shows what it wraps only when access is allowed, else the fallback: the ${n.label} screen is never rendered for anyone else. */`,
    `export const ${n.expression} = defineExpression<${n.expressionProps}>('${n.expression}', ({ access, children }) => {`,
    "  if (access.status === 'allowed') return <>{children}</>;", `  return <${n.fallback} access={access} />;`, '});',
  );
}

function hookStubText(useClient) {
  return lines(
    useClient ? ["'use client';", ''] : [],
    "import { createContext, useContext } from 'react';", "import type { Session } from '../types';", '',
    '/** The session every guard of this feature reads. It is signed out until a provider above the screen supplies one, so a screen nobody wired is closed, never open by accident. */',
    "export const SessionContext = createContext<Session>({ status: 'signed-out' });", '',
    '/** Who is looking at the screen right now: the session of the nearest `SessionContext.Provider`, signed out when there is none. */',
    'export function useSession(): Session {', '  return useContext(SessionContext);', '}',
  );
}

function hookProviderText(n, source, useClient) {
  return lines(
    useClient ? ["'use client';", ''] : [],
    `import { ${source.hook} } from '${source.spec}';`, "import type { Session } from '../types';", '',
    `/** Who is looking at the ${n.label} screen, read from the project's session provider (${source.hook}); its value is a Session, and the type-check says so if it is not. */`,
    `export function ${n.sessionHook}(): Session {`, `  return ${source.hook}();`, '}',
  );
}

function controllerText(n, source, useClient) {
  const hook = source.kind === 'stub' ? 'useSession' : n.sessionHook;
  const file = source.kind === 'stub' ? 'useSession' : n.sessionHook;
  return lines(
    useClient ? ["'use client';", ''] : [],
    "import type { ReactNode } from 'react';", importLine('defineController'),
    `import { ${n.decide} } from '../domain/${n.domain}.domain';`, `import { ${n.expression} } from '../expressions/${n.expression}.expression';`, `import { ${hook} } from '../hooks/${file}.hook';`, '',
    `export interface ${n.controllerProps} {`, '  children?: ReactNode;', '}', '',
    `/** Guards the ${n.label} screen: reads who is signed in, decides, and renders its children only when allowed. Wraps ${n.controllerName} in the route entry; it holds no logic of its own. */`,
    `export const ${n.controller} = defineController<${n.controllerProps}>('${n.controller}', ({ children }) => {`,
    `  const session = ${hook}();`, `  const access = ${n.decide}({ session });`, `  return <${n.expression} access={access}>{children}</${n.expression}>;`, '});',
  );
}

// ---------------------------------------------------------------------------------------------------------------- files

/**
 * The files a guard writes, without touching the disk: `{ path (absolute), content, layer }`. The `public` access writes none. Throws a usage error for an invalid request.
 *
 * @param {string} root Project root (its architecture.yml decides the framework and the folders; its providers decide the session source).
 * @param {{ name: string, feature: string, access: string, roles?: string[] | string, redirect?: string, route?: string }} request The guard.
 * @returns {{ path: string, content: string, layer: string }[]} The files, in write order.
 * @throws {Error} A usage error naming the problem.
 *
 * @example
 * guardFiles(root, { name: 'Products', feature: 'shop', access: 'signed-in' }).map((f) => path.basename(f.path)); // => ['ProductsAccess.domain.ts', 'useSession.hook.ts', ...]
 */
export function guardFiles(root, request) {
  const issue = guardArgIssue(request);
  if (issue) throw usage(issue.message);
  if (request.access === 'public') return [];
  const n = namesOf(request.name);
  const dir = featureDirOf(root, request.feature);
  const useClient = frameworkOf(root) !== 'react-spa';
  const source = sessionSourceOf(root, request.feature);
  const at = (folder, base) => path.join(dir, folder, base);
  return [
    { path: at('domain', `${n.domain}.domain.ts`), content: domainText(n, request), layer: 'domain' },
    source.kind === 'stub'
      ? { path: at('hooks', 'useSession.hook.ts'), content: hookStubText(useClient), layer: 'hook' }
      : { path: at('hooks', `${n.sessionHook}.hook.ts`), content: hookProviderText(n, source, useClient), layer: 'hook' },
    { path: at('components', `${n.fallback}.component.tsx`), content: fallbackText(n, request), layer: 'component' },
    { path: at('expressions', `${n.expression}.expression.tsx`), content: expressionText(n), layer: 'expression' },
    { path: at('controllers', `${n.controller}.controller.tsx`), content: controllerText(n, source, useClient), layer: 'controller' },
  ];
}

/**
 * The file name of the proof of a guard: `<Name>Guard.proof.test.ts` (READ-004: name, layer, extension), which `construct test proof <feature>` and a plan's `test.proof` step run.
 *
 * @param {string} name The guarded screen, PascalCase.
 * @returns {string} The proof's file name.
 *
 * @example
 * guardProofName('Products'); // => 'ProductsGuard.proof.test.ts'
 */
export function guardProofName(name) {
  return `${name}Guard.proof.test.ts`;
}

const routeOf = (request) => request.route ?? routePathOf(request.name);

/**
 * The files a `guard.route` step declares as its `touches.files`: the guard's units (`create`), the feature's `types.ts` and barrel and the route entry (`modify`),
 * the proof (`create`) and `architecture.yml` (`modify`, the test regions). Read-only and never throws: an invalid request answers `null`; `public` writes nothing and answers `[]`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, access: string, roles?: string[] | string, redirect?: string, route?: string }} request The step's arguments.
 * @returns {{ path: string, change: 'create'|'modify', layer?: string }[] | null} The files, or `null`.
 *
 * @example
 * guardTouches(root, { name: 'Products', feature: 'shop', access: 'public' }); // => []
 */
export function guardTouches(root, request) {
  try {
    const files = guardFiles(root, request);
    if (!files.length) return [];
    const feature = featureDirOf(root, request.feature);
    return [
      ...files.map((f) => ({ path: rel(root, f.path), change: 'create', layer: f.layer })),
      { path: rel(root, path.join(feature, 'types.ts')), change: 'modify', layer: 'domain' },
      { path: rel(root, path.join(feature, 'index.ts')), change: 'modify' },
      { path: routeEntryFile(root, routeOf(request)).file, change: 'modify', layer: 'route' },
      ...blockProofTouches(root, request.feature, guardProofName(request.name)),
    ];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------- route entry

/**
 * The pure edit of a route entry: the controller element becomes `<Guard><Controller /></Guard>` and the guard's import goes after the controller's own import.
 * Idempotent (an entry that already renders the guard changes nothing). Refuses an entry that does not render the controller exactly once.
 *
 * @param {string} source The current text of the route entry (`app/<route>/page.tsx` or `src/App.tsx`).
 * @param {{ controller: string, guard: string, importPath: string }} options The controller's exported name, the guard controller's exported name and its import path from the entry.
 * @returns {{ source: string, changed: boolean }} The new text and whether it differs.
 * @throws {Error} A usage error when the entry renders the controller zero times or more than once, or does not import it.
 *
 * @example
 * guardRouteSource("import { PC } from './a';\nexport default () => <PC />;\n", { controller: 'PC', guard: 'PG', importPath: './b' }).source.includes('<PG><PC /></PG>'); // => true
 */
export function guardRouteSource(source, { controller, guard, importPath }) {
  if (new RegExp(`<${escapeRe(guard)}\\b`).test(source)) return { source, changed: false };
  const found = source.match(elementRe(controller)) ?? [];
  if (found.length !== 1) throw usage(`The route entry renders <${controller} /> ${found.length === 0 ? 'nowhere' : `${found.length} times`}, so the guard cannot be wired to it. ${found.length === 0 ? `Wire the route first: construct create route ${controller.replace(/Controller$/, '')} --feature <feature>.` : 'Guard one of them by hand.'}`);
  const importLine = source.split('\n').findIndex((l) => new RegExp(`^import\\s*\\{[^}]*\\b${escapeRe(controller)}\\b[^}]*\\}\\s*from\\s*(['"])`).test(l));
  if (importLine < 0) throw usage(`The route entry does not import ${controller} by name, so the guard cannot be wired to it.`);
  const lines_ = source.split('\n');
  const quote = /from\s*(['"])/.exec(lines_[importLine])[1];
  lines_.splice(importLine + 1, 0, `import { ${guard} } from ${quote}${importPath}${quote};`);
  const next = lines_.join('\n').replace(elementRe(controller), `<${guard}><${controller} /></${guard}>`);
  return { source: next, changed: true };
}

/** The route entry a guard edits: its file (absolute and project-relative) and the text it would have once wired; refuses, with the reason, when there is nothing to wire to. */
function routeEdit(root, n, request) {
  const route = routeOf(request);
  const { file } = routeEntryFile(root, route);
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) throw usage(`The route entry ${file} does not exist, so there is no route to guard. Wire the route first: construct create route ${request.name} --feature ${request.feature}${request.route ? ` --route ${request.route}` : ''}.`);
  const guardFile = path.join(featureDirOf(root, request.feature), 'controllers', `${n.controller}.controller`);
  const spec = path.relative(path.dirname(abs), guardFile).split(path.sep).join('/');
  const edited = guardRouteSource(fs.readFileSync(abs, 'utf8'), { controller: n.controllerName, guard: n.controller, importPath: spec.startsWith('.') ? spec : `./${spec}` });
  return { file, abs, ...edited };
}

// ---------------------------------------------------------------------------------------------------------------- proof

function proofText(root, request, source) {
  const n = namesOf(request.name);
  const role = request.access === 'role';
  const roles = rolesOf(request.roles);
  const stub = source.kind === 'stub';
  const command = `construct create guard ${request.name} --feature ${request.feature} --access ${request.access}${role ? ` --roles ${roles.join(',')}` : ''}${request.redirect ? ` --redirect ${request.redirect}` : ''}${request.route ? ` --route ${request.route}` : ''}`;
  const relPath = `features/${request.feature}/tests/generated/${guardProofName(request.name)}`;
  const signedOutText = `Sign in to open the ${n.label} screen.`;
  const wrongText = role ? `You need one of these roles to open the ${n.label} screen: ${roles.join(', ')}.` : `You do not have access to the ${n.label} screen.`;
  const render = stub
    ? [`const render = (session: Session | null, children: ReactNode): string => renderToString(session === null ? createElement(${n.controller}, {}, children) : createElement(SessionContext.Provider, { value: session }, createElement(${n.controller}, {}, children)));`]
    : [`const render = (session: Session, children: ReactNode): string => renderToString(createElement(${n.expression}, { access: ${n.decide}({ session }) }, children));`];
  return `${[
    ...proofHeader({ command, feature: request.feature, subject: `${n.Name} guard (access ${request.access})` }),
    `// run: construct test proof ${request.feature}   (on its own: npx tsx --test ${relPath})`,
    '//',
    `// Proves the guard of the ${n.label} screen with no browser and no server, by rendering it: a signed-out visitor${role ? ' and a signed-in person without the role' : ''} see ONLY the fallback (the screen is`,
    `// nowhere in the markup), a person who is allowed sees ONLY the screen, and the decision gives ${role ? 'signed-out, wrong-role and allowed' : 'signed-out and allowed'}.`,
    ...(stub ? ['// With no session provider above it the guard is closed: the fallback shows. A failure names who was let in or kept out.'] : ["// The session comes from the project's own provider, so the proof drives the decision and the expression, which are what the guard is made of."]),
    '',
    "import { test } from 'node:test';", "import assert from 'node:assert/strict';", "import { createElement } from 'react';", "import type { ReactNode } from 'react';", "import { renderToString } from 'react-dom/server';",
    `import { ${n.decide} } from '../../domain/${n.domain}.domain';`, `import { ${n.expression} } from '../../expressions/${n.expression}.expression';`,
    ...(stub ? [`import { ${n.controller} } from '../../controllers/${n.controller}.controller';`, "import { SessionContext } from '../../hooks/useSession.hook';"] : []),
    "import type { Session } from '../../types';", '',
    "const SCREEN = 'the-protected-screen';",
    "const SIGNED_OUT: Session = { status: 'signed-out' };",
    ...(role ? [`const WRONG_ROLE: Session = { status: 'signed-in', userId: 'visitor-1', roles: ['visitor'] };`, `const ALLOWED: Session = { status: 'signed-in', userId: 'member-1', roles: [${lit(roles[0])}] };`] : ["const ALLOWED: Session = { status: 'signed-in', userId: 'member-1', roles: [] };"]),
    `const SIGNED_OUT_TEXT = ${lit(signedOutText)};`, ...(role ? [`const WRONG_ROLE_TEXT = ${lit(wrongText)};`] : []), '',
    '/** What a person would see: the protected screen, the fallback, or nothing. */',
    'function stateOf(html: string): string {', '  if (html.includes(SCREEN)) return \'screen\';', '  if (html.includes(\'role="alert"\')) return \'fallback\';', "  return 'nothing';", '}', '',
    ...EXPECT_LINES, '',
    'const screen = createElement(\'p\', { id: SCREEN }, SCREEN);', '',
    ...render, '',
    `test(${lit(`${n.Name} guard: a signed-out visitor sees only the fallback`)}, () => {`,
    '  const html = render(SIGNED_OUT, screen);',
    "  expectState('A signed-out visitor', 'fallback', stateOf(html));",
    "  assert.ok(html.includes(SIGNED_OUT_TEXT), 'the fallback says to sign in');", ...(request.redirect ? [`  assert.ok(html.includes(${lit(`<a href="${request.redirect}">`)}), 'the fallback links to the redirect target');`] : []), '});', '',
    ...(role ? [
      `test(${lit(`${n.Name} guard: a signed-in person without the role sees only the fallback`)}, () => {`,
      '  const html = render(WRONG_ROLE, screen);',
      "  expectState('A signed-in person without the role', 'fallback', stateOf(html));",
      "  assert.ok(html.includes(WRONG_ROLE_TEXT), 'the fallback names the roles that are needed');", '});', '',
    ] : []),
    `test(${lit(`${n.Name} guard: ${role ? 'a person with the role' : 'a signed-in person'} sees only the screen`)}, () => {`,
    '  const html = render(ALLOWED, screen);',
    `  expectState('A ${role ? 'person with the role' : 'signed-in person'}', 'screen', stateOf(html));`,
    "  assert.ok(!html.includes('role=\"alert\"'), 'no fallback beside the screen');", '});', '',
    ...(stub ? [
      `test(${lit(`${n.Name} guard: a screen with no session provider above it is closed`)}, () => {`,
      '  const html = render(null, screen);',
      "  expectState('The guard with no session provider', 'fallback', stateOf(html));", '});', '',
    ] : []),
    `test(${lit(`${n.Name} guard: the decision`)}, () => {`,
    "  expectState('A signed-out session', 'signed-out', " + `${n.decide}({ session: SIGNED_OUT }).status);`,
    ...(role ? ["  expectState('A signed-in session without the role', 'wrong-role', " + `${n.decide}({ session: WRONG_ROLE }).status);`] : []),
    `  expectState('${role ? 'A session with the role' : 'A signed-in session'}', 'allowed', ${n.decide}({ session: ALLOWED }).status);`, '});', '',
    `test(${lit(`${n.Name} guard: the fallback replaces the screen, it does not sit beside it`)}, () => {`,
    `  const denied = renderToString(createElement(${n.expression}, { access: { status: 'signed-out' } }, screen));`,
    "  expectState('The expression given a denied access', 'fallback', stateOf(denied));",
    `  const open = renderToString(createElement(${n.expression}, { access: { status: 'allowed' } }, screen));`,
    "  expectState('The expression given an allowed access', 'screen', stateOf(open));", '});',
  ].join('\n')}\n`;
}

// ------------------------------------------------------------------------------------------------------------------ write

/**
 * Write a guard into the project: its units, the feature's types, the route entry edit, the barrel and the locked proof. `public` writes nothing. Everything that can refuse
 * is checked before the first byte is written (an existing file with other content, a route entry that does not render the controller, a `Session` or `Access` type that means
 * something else), so a refusal changes nothing. Idempotent: a second run reports `changed: false`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, feature: string, access: string, roles?: string[] | string, redirect?: string, route?: string }} request The guard.
 * @returns {{ access: string, noop: boolean, changed: boolean, files: string[], route: string | null, session: string, notes: string[] }} The project-relative files changed, the route entry it edited, where the session is read from and notes.
 * @throws {Error} A usage error naming why nothing was written.
 *
 * @example
 * generateGuard(root, { name: 'Products', feature: 'shop', access: 'signed-in' }).files; // => ['features/shop/domain/ProductsAccess.domain.ts', ...]
 */
export function generateGuard(root, request) {
  const issue = guardArgIssue(request);
  if (issue) throw usage(issue.message);
  if (request.access === 'public') return { access: 'public', noop: true, changed: false, files: [], route: null, session: 'none', notes: ['public: no guard was written. A route without a guard is open to everyone, which is what "public" means; an existing guard is not removed.'] };
  assertFeature(root, request.feature);
  const n = namesOf(request.name);
  const source = sessionSourceOf(root, request.feature);
  const units = guardFiles(root, request);
  const declared = withDeclarations(root, request.feature, [SESSION_TYPE, ACCESS_TYPE]);
  if (declared.conflicts.length) throw usage(`types.ts of "${request.feature}" already declares ${declared.conflicts.join(' and ')} for something else, so the guard cannot build on it. Rename that type, then run this again. Nothing was written.`);
  const edit = routeEdit(root, n, request);
  const proof = proofText(root, request, source);
  const domainFile = units.find((u) => u.layer === 'domain');
  if (fs.existsSync(domainFile.path) && fs.readFileSync(domainFile.path, 'utf8') !== domainFile.content) throw usage(`The ${request.name} screen is already guarded by another rule (${rel(root, domainFile.path)} differs from what ${request.access} would write). Change the rule in that file, or remove the guard's files and run this again. Nothing was written.`);
  const written = writeOwned(root, units); // refuses first when another unit exists with other content
  const changed = [...written.written];
  if (declared.changed) {
    write(path.join(featureDirOf(root, request.feature), 'types.ts'), declared.text);
    changed.push(rel(root, path.join(featureDirOf(root, request.feature), 'types.ts')));
  }
  if (edit.changed) {
    write(edit.abs, edit.source);
    changed.push(edit.file);
  }
  const api = syncPublicApi(root, request.feature);
  if (api.changed) changed.push(api.path);
  const wrote = writeBlockProof(root, request.feature, guardProofName(request.name), proof);
  if (wrote.changed) changed.push(wrote.file);
  if (wrote.regions.length) changed.push('architecture.yml');
  selfCheck(root, [...units.map((u) => u.path), ...(edit.changed ? [edit.abs] : [])]);
  return {
    access: request.access, noop: false, changed: changed.length > 0, files: changed, route: edit.file, session: source.kind === 'stub' ? 'stub' : source.id,
    notes: [source.kind === 'stub' ? 'The session is signed out until a SessionContext.Provider above the screen supplies one (hooks/useSession.hook.ts): supply the signed-in person there.' : `The session is read from ${source.hook} (its value must be a Session).`],
  };
}

// ---------------------------------------------------------------------------------------------------------------- the question

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);
const slug = (text) => words(text).join('-').toLowerCase();

/**
 * The roles a requirement card names: its state nouns that carry the property `role` (`admin`), as role names. Pure.
 *
 * @param {{ nouns?: { kind: string, text: string, properties?: string[] }[] } | null | undefined} card The requirement card.
 * @returns {string[]} The role names, unique, in order, at most `MAX_ROLES`.
 *
 * @example
 * cardRoles(card); // => ['admin']
 */
export function cardRoles(card) {
  const found = (card?.nouns ?? []).filter((x) => x.kind === 'state' && (x.properties ?? []).includes('role')).map((x) => slug(x.text)).filter((r) => ROLE_RE.test(r));
  return [...new Set(found)].slice(0, MAX_ROLES);
}

/**
 * The closed question about who may open a screen (chooser summary shape, id `q-access`): `public`, `signed-in` and `role`, with the rules-only default FIRST (so the
 * built-in provider suggests it): `role` when the card names a role (a state noun with the property `role`, like "admin"), else `signed-in` when it has a session state
 * noun ("logged-in user"), else `public`. `role` is offered disabled, with the reason, when the card names no role. An unanswered question uses its default, so it never holds
 * a plan back; a `role` answer the card cannot support is refused. Pure.
 *
 * @param {object | null | undefined} card The requirement card (`options.card` of `planFromBlocks`).
 * @param {{ name: string, answer?: string | { option: string } }} request The screen and an answer.
 * @returns {{ question: object, access: string, roles: string[], refused: string | null }} The question, the access the plan uses, its roles, and why an answer was refused.
 *
 * @example
 * accessOffer(cardOf('A logged-in user wants to see the products'), { name: 'Products' }).access; // => 'signed-in'
 */
export function accessOffer(card, request) {
  const nouns = card?.nouns ?? [];
  const session = nouns.some((x) => x.kind === 'state' && (x.properties ?? []).includes('session'));
  const roles = cardRoles(card);
  const label = words(request.name).join(' ').toLowerCase();
  const all = {
    public: { id: 'public', label: 'Anyone can open it', enabled: true, why: 'No guard: the route is open to everyone.' },
    'signed-in': { id: 'signed-in', label: 'Only a signed-in person', enabled: true, why: 'A typed session check: a person who is not signed in sees a notice, never the screen.' },
    role: roles.length
      ? { id: 'role', label: `Only ${roles.join(' or ')}`, enabled: true, why: `Signed in, and holding one of the roles the requirement names: ${roles.join(', ')}.` }
      : { id: 'role', label: 'Only some roles', enabled: false, why: 'The requirement names no role. Run: construct create guard <Name> --feature <f> --access role --roles a,b.' },
  };
  const first = roles.length ? 'role' : session ? 'signed-in' : 'public';
  const options = [first, ...GUARD_ACCESS.filter((a) => a !== first)].map((id) => all[id]);
  const chosen = answerOf(request.answer)?.option;
  const known = options.find((o) => o.id === chosen);
  const refused = chosen && (!known || !known.enabled) ? (known ? known.why : `"${chosen}" is not an option of ${ACCESS_QUESTION_ID}: ${GUARD_ACCESS.join(', ')}.`) : null;
  const used = known?.enabled ? known.id : first;
  const question = { id: ACCESS_QUESTION_ID, question: `Who may open the ${label} screen?`, options, default: first, chosen: known?.enabled ? known.id : null };
  return { question, access: used, roles: used === 'role' ? roles : [], refused };
}
