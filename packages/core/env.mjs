// #632 (part of #616) -- environment configuration as a deterministic block: `add.env` adds one variable NAME to `.env.example` with a
// placeholder value and a comment, never a real value. Zero-LLM, one fixed template, idempotent. It exists so a chain that needs a
// secret (a card with `server-only-secret`, or a `validated-redirect`) says WHICH variables the project must define instead of leaving
// that to a by-hand step.
//   envArgProblem(args)                first reason an `add.env` request is invalid (pure; plan.mjs uses it), or null
//   envVariableName(request, framework) the final variable name: the scope decides the public prefix (NEXT_PUBLIC_ or, for react-spa, VITE_)
//   envTouches(root, request)          the file the step writes: `.env.example` (create when absent, else modify)
//   addEnv(root, request)              write it (idempotent: a name already listed is left alone)
//   secretsOfCard(card)                the variables a requirement card's checks call for
//   envOffers(root, secrets, answers)  the closed questions (`q-env`: add | skip), one per variable not yet in `.env.example`
// The result never holds a secret: with no `value` the placeholder is `your-<name>-here`, and a `value` is refused when the NAME looks
// secret-shaped (a real key must never be pasted into a file that is committed). CLIENT-001 (client-boundary.mjs) is the reader of the
// other half: a server-scope name read in a 'use client' file (or a file only it imports) is a violation, so a `server` variable
// belongs to a server action, a route handler or a server component, and only a `public` one may be read in the browser.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';
import { write } from './fs.mjs';

const usage = (message) => new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });

/** The one file `add.env` writes, at the project root. Never `.env`: real values do not belong in anything a plan writes. */
export const ENV_FILE = '.env.example';

/** The closed choice that decides the public prefix: `server` (never reaches the browser) or `public` (inlined into the browser bundle). */
export const ENV_SCOPES = Object.freeze(['server', 'public']);

/** A variable name: upper case letters, digits and `_`, starting with a letter, at most 64 characters. */
export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The id of the closed question about one variable (chooser summary shape, like `q-route`). Several variables get `q-env-<kebab-name>`. */
export const ENV_QUESTION_ID = 'q-env';

/** The public prefix per framework: what the bundler inlines into the browser. */
export const PUBLIC_PREFIXES = Object.freeze({ nextjs: 'NEXT_PUBLIC_', 'react-spa': 'VITE_' });

const ALL_PUBLIC_PREFIXES = Object.freeze(Object.values(PUBLIC_PREFIXES));
const SECRET_SHAPED = /(SECRET|PASSW(?:OR)?D|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|SIGNING|SESSION_?KEY|SALT|(?:^|_)KEY$)/;
const VALUE_RE = /^[A-Za-z0-9._:/@+=-]{0,200}$/;
const MAX_COMMENT = 120;

/**
 * Whether a variable NAME looks like it holds a secret (SECRET, PASSWORD, TOKEN, PRIVATE, CREDENTIAL, API_KEY, ACCESS_KEY, SIGNING,
 * SALT or a `_KEY` suffix). A name-shape rule, nothing is read from any value.
 *
 * @param {string} name A variable name.
 * @returns {boolean} `true` for a secret-shaped name.
 *
 * @example
 * looksSecret('STRIPE_SECRET_KEY'); // => true
 */
export function looksSecret(name) {
  return SECRET_SHAPED.test(String(name));
}

/**
 * The final variable name: `public` puts the framework's public prefix in front (unless it is already there), `server` leaves the name.
 *
 * @param {{ name: string, scope: string }} request The base name and the scope.
 * @param {string} [framework] The project's framework (`nextjs` by default).
 * @returns {string} The name written to `.env.example`.
 *
 * @example
 * envVariableName({ name: 'API_URL', scope: 'public' }, 'nextjs'); // => 'NEXT_PUBLIC_API_URL'
 */
export function envVariableName({ name, scope }, framework = 'nextjs') {
  if (scope !== 'public') return name;
  const prefix = PUBLIC_PREFIXES[framework] ?? PUBLIC_PREFIXES.nextjs;
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

/**
 * The first reason an `add.env` request is not valid, and which argument it is about, or `null`. Pure: nothing is read from the disk. The rules: the name is
 * `[A-Z][A-Z0-9_]{0,63}`; the scope is `server` or `public`; a server variable does not carry a public prefix; a supplied `value`
 * is a plain token (no spaces, quotes or `$`) and is refused when the NAME looks secret-shaped (leave the value out and a placeholder is
 * written); a `comment` is one line of at most 120 characters.
 *
 * @param {{ name?: unknown, scope?: unknown, value?: unknown, comment?: unknown }} args The request.
 * @returns {{ arg: 'name'|'scope'|'value'|'comment', message: string } | null} The problem in plain words and its argument, or `null` when the request is valid.
 *
 * @example
 * envArgIssue({ name: 'stripe', scope: 'server' })?.arg; // => 'name'
 */
export function envArgIssue(args) {
  const { name, scope, value, comment } = args ?? {};
  if (typeof name !== 'string' || !ENV_NAME_RE.test(name)) return { arg: 'name', message: 'A variable name is upper case letters, digits and "_", starting with a letter (STRIPE_SECRET_KEY), at most 64 characters.' };
  if (!ENV_SCOPES.includes(scope)) return { arg: 'scope', message: `The scope is one of: ${ENV_SCOPES.join(', ')}. "public" is inlined into the browser bundle; "server" never leaves the server.` };
  if (scope === 'server' && ALL_PUBLIC_PREFIXES.some((p) => name.startsWith(p))) return { arg: 'name', message: `${name} starts with a public prefix, so the browser would see it. Choose scope public, or drop the prefix.` };
  if (value !== undefined) {
    if (typeof value !== 'string' || !VALUE_RE.test(value)) return { arg: 'value', message: 'A value is a plain token of at most 200 characters (letters, digits and . _ : / @ + = -), with no spaces, quotes or "$".' };
    if (looksSecret(name)) return { arg: 'value', message: `${name} looks like a secret, so no value is written to a file that is committed. Leave the value out: a placeholder is written, and the real value goes in .env, which is not committed.` };
  }
  if (comment !== undefined && (typeof comment !== 'string' || !comment.trim() || comment.length > MAX_COMMENT || /[\r\n]/.test(comment))) return { arg: 'comment', message: `A comment is one line of at most ${MAX_COMMENT} characters.` };
  return null;
}

/**
 * The first reason an `add.env` request is not valid, or `null` (`envArgIssue` without the argument).
 *
 * @param {{ name?: unknown, scope?: unknown, value?: unknown, comment?: unknown }} args The request.
 * @returns {string | null} The problem in plain words, or `null` when the request is valid.
 *
 * @example
 * envArgProblem({ name: 'STRIPE_SECRET_KEY', scope: 'server', value: 'sk_live_x' }); // => 'STRIPE_SECRET_KEY looks like a secret, ...'
 */
export function envArgProblem(args) {
  return envArgIssue(args)?.message ?? null;
}

const frameworkOf = (root) => {
  try {
    return loadConfig(root).project?.framework ?? 'nextjs';
  } catch {
    return 'nextjs';
  }
};

const placeholderOf = (variable) => `your-${variable.toLowerCase().replace(/_/g, '-')}-here`;
const defaultComment = (scope) => (scope === 'public' ? 'Public: inlined into the browser bundle. Never put a secret here.' : 'Server only: read in a server action, route handler or server component, never in a "use client" file.');
const NAME_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

const namesIn = (text) => new Set(text.split(/\r?\n/).map((l) => NAME_LINE.exec(l)?.[1]).filter(Boolean));

/**
 * The file an `add.env` step touches, for a plan step's `touches.files`: `.env.example`, `create` when it is absent, else `modify`.
 * Read-only and never throws.
 *
 * @param {string} root Project root.
 * @param {{ name: string, scope: string, value?: string, comment?: string }} request The variable.
 * @returns {{ path: string, change: 'create'|'modify' }[] | null} The file, or `null` for an invalid request.
 *
 * @example
 * envTouches(root, { name: 'STRIPE_SECRET_KEY', scope: 'server' }); // => [{ path: '.env.example', change: 'create' }]
 */
export function envTouches(root, request) {
  if (envArgProblem(request)) return null;
  return [{ path: ENV_FILE, change: fs.existsSync(path.join(root, ENV_FILE)) ? 'modify' : 'create' }];
}

/**
 * Add one variable to `.env.example`: a `# comment` line and `NAME=placeholder`, appended after a blank line, creating the file when
 * it is absent. Idempotent: a name already listed (with or without a value) leaves the file alone. Never writes `.env`, never
 * writes a real value: with no `value` the placeholder is `your-<name>-here`.
 *
 * @param {string} root Project root.
 * @param {{ name: string, scope: 'server'|'public', value?: string, comment?: string }} request The base name, the scope, an optional
 *   non-secret value and an optional one-line comment.
 * @returns {{ file: string, variable: string, changed: boolean, created: boolean, line: string, warning: string | null }} The file
 *   (project-relative), the final variable name, whether it was written, whether the file is new, the line written and a warning
 *   (a `public` variable whose name looks secret).
 * @throws {Error} A usage error for an invalid request (see `envArgProblem`) or an `.env.example` that is a symbolic link.
 *
 * @example
 * addEnv(root, { name: 'STRIPE_SECRET_KEY', scope: 'server' }).line; // => 'STRIPE_SECRET_KEY=your-stripe-secret-key-here'
 */
export function addEnv(root, request) {
  const problem = envArgProblem(request);
  if (problem) throw usage(problem);
  const variable = envVariableName(request, frameworkOf(root));
  const line = `${variable}=${request.value ?? placeholderOf(variable)}`;
  const warning = request.scope === 'public' && looksSecret(variable) ? `${variable} is a public variable (inlined into the browser bundle) but its name looks like a secret. A secret belongs in a server variable.` : null;
  const file = path.join(root, ENV_FILE);
  let current = '';
  const exists = fs.existsSync(file);
  if (exists) {
    if (fs.lstatSync(file).isSymbolicLink()) throw usage(`${ENV_FILE} is a symbolic link, so it is not edited. Replace it with a regular file first.`);
    current = fs.readFileSync(file, 'utf8');
    if (namesIn(current).has(variable)) return { file: ENV_FILE, variable, changed: false, created: false, line, warning };
  }
  const gap = current === '' ? '' : `${current.endsWith('\n') ? '' : '\n'}${current.endsWith('\n\n') ? '' : '\n'}`;
  write(file, `${current}${gap}# ${request.comment ?? defaultComment(request.scope)}\n${line}\n`);
  return { file: ENV_FILE, variable, changed: true, created: !exists, line, warning };
}

/**
 * The variables a requirement card calls for, by its checks: `server-only-secret` asks for `<SERVICE>_SECRET_KEY` (server) for every
 * outside service the card names (Stripe: `STRIPE_SECRET_KEY`), `validated-redirect` for the allow-list (`ALLOWED_REDIRECT_ORIGINS`,
 * server). A card with the check but no named service gets no invented variable: the secret has no name yet. Pure, in card order.
 *
 * @param {{ nouns?: { kind: string, text: string }[], checks?: { name: string }[] }} card A requirement card.
 * @returns {{ name: string, scope: 'server', check: string, why: string }[]} The variables, each with the check that calls for it.
 *
 * @example
 * secretsOfCard(parseRequirement('A user wants to safely manage billing Stripe').card).map((s) => s.name); // => ['STRIPE_SECRET_KEY', 'ALLOWED_REDIRECT_ORIGINS']
 */
export function secretsOfCard(card) {
  const checks = new Set((card?.checks ?? []).map((c) => c.name));
  const out = [];
  if (checks.has('server-only-secret')) {
    for (const noun of card.nouns ?? []) {
      if (noun.kind !== 'external') continue;
      const stem = String(noun.text).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const name = `${stem}_SECRET_KEY`;
      if (/^[A-Z]/.test(name) && ENV_NAME_RE.test(name) && !out.some((s) => s.name === name)) out.push({ name, scope: 'server', check: 'server-only-secret', why: `The ${noun.text} secret key: it stays on the server.` });
    }
  }
  if (checks.has('validated-redirect')) out.push({ name: 'ALLOWED_REDIRECT_ORIGINS', scope: 'server', check: 'validated-redirect', why: 'The allow-list a redirect is checked against.' });
  return out;
}

const answerOf = (answer) => (typeof answer === 'string' ? { option: answer } : answer && typeof answer === 'object' ? answer : null);
const kebab = (name) => name.toLowerCase().replace(/_/g, '-');
const cap = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The closed questions about the variables a card calls for (chooser summary shape, id `q-env`, or `q-env-<kebab-name>` when there are
 * several): `add` (add the variable to `.env.example`, placeholder and comment) or `skip`. A variable already listed in `.env.example`
 * raises no question. An unanswered question uses its default (`add`), so it never holds a plan back. Reads only.
 *
 * @param {string} root Project root.
 * @param {{ name: string, scope: 'server'|'public', why?: string }[]} secrets From `secretsOfCard`.
 * @param {Record<string, string | { option: string }>} [answers] Answers by question id.
 * @returns {{ question: object, request: { name: string, scope: string }, variable: string, add: boolean, id: string }[]} One entry per variable, in order.
 *
 * @example
 * envOffers(root, secretsOfCard(card), { 'q-env-stripe-secret-key': 'skip' }).map((o) => [o.id, o.add]);
 */
export function envOffers(root, secrets, answers = {}) {
  const file = path.join(root, ENV_FILE);
  const listed = fs.existsSync(file) ? namesIn(fs.readFileSync(file, 'utf8')) : new Set();
  const framework = frameworkOf(root);
  const fresh = (secrets ?? []).filter((s) => !envArgProblem(s) && !listed.has(envVariableName(s, framework)));
  return fresh.map((s) => {
    const variable = envVariableName(s, framework);
    const id = fresh.length === 1 ? ENV_QUESTION_ID : `${ENV_QUESTION_ID}-${kebab(variable)}`;
    const options = [
      { id: 'add', label: cap(`Add ${variable} to ${ENV_FILE}`, 60), enabled: true, why: `A placeholder line and a comment (${s.scope} scope); the real value goes in .env, which is not committed.` },
      { id: 'skip', label: 'Do not add it', enabled: true, why: 'The code that reads it has nothing to document until you add the line by hand.' },
    ];
    const chosen = answerOf(answers[id])?.option;
    const known = options.some((o) => o.id === chosen);
    const question = { id, question: cap(`The plan needs ${variable}${s.why ? ` (${s.why.replace(/\.$/, '')})` : ''}. Add it to ${ENV_FILE}?`, 160), options, default: 'add', variable, scope: s.scope, chosen: known ? chosen : null };
    return { question, request: { name: s.name, scope: s.scope }, variable, add: (known ? chosen : 'add') === 'add', id };
  });
}
