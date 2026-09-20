// Construct UI backend — a small Express server that calls the core CLI's
// exported functions (create/refactor/research/importCommand from
// src/cli.mjs) directly, in-process. It never shells out to the `construct`
// binary: this is the same Node project, same module graph, so the real
// functions are imported and called exactly as bin/construct.mjs does.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { AuthConfigError, createAuth, isLoopbackHost, resolveAuthConfig } from './auth.mjs';
import { create, refactor, research, importCommand, init } from '../../../src/cli.mjs';
import { findProjectRoot } from '../../../src/config.mjs';
import { USAGE } from '../../../src/usage.mjs';
import { HELP_TOPICS, TOPIC_ORDER, getTopLevelHelpText } from '../../../src/repl.mjs';
import { getSettings, updateSettings, getBrowseRoots } from './settings.mjs';
import { handleBrowse } from './dirBrowse.mjs';
import { runCapturing, withDir } from './commandRunner.mjs';
import { attachWizardSocket } from './wizardSocket.mjs';
import { createProcessesService } from './processesService.mjs';
import { createProcessesRouter } from './processesApi.mjs';
import { attachProcessesSocket } from './processesSocket.mjs';
import { createReviewRouter } from './reviewApi.mjs';
import { createReviewJobs } from './reviewJobs.mjs';
import { refuseUnknownUpgrades } from './wsUpgrade.mjs';
import { getOllamaStatus, listOllamaModels, startOllamaPull, removeOllamaModel } from './ollama.mjs';
import {
  PagesEditorError,
  listFeatures,
  listPages,
  resolvePageFile,
  serializeTree,
  getNodeSnippet,
  patchNode,
  getNodeProps,
  buildAttributeSnippet,
  findUnmappedProps,
  getScopeLinks,
  applyAutoMap,
  checkEnforcement,
  hashOf,
  parseSnippetToTree,
  rewireWireInSnippet,
  removeNodeInSnippet,
  moveNodeInSnippet,
  addChildInSnippet,
} from './pagesEditor.mjs';
import { handleValidate } from './validateApi.mjs';
import { handleLogs } from './logBuffer.mjs';
import { unitsIndex, unitSummary, featuresIndex, featureSummary } from './unitsApi.mjs';
import { readPageSource } from './pageSource.mjs';
import { viewPage, openReference } from './projectNav.mjs';
import { describePageChange, adoptOwnWrite, pageChangeTracker } from './pageChanges.mjs';
import { listWorkflowFeatures, listWorkflowFiles, readWorkflowMachines, readWorkflowNarrative, editWorkflowFile } from './workflowsViewer.mjs';
import {
  AutoCommitError, answerDirtyPrompt, flushSession, getSessionStatus,
  recordSave, setSessionPlan, updateCommitConfig,
} from './autoCommit.mjs';

// This server is a local dev tool, but it has real teeth: /api/import (and
// friends) read an arbitrary path off disk and, with --llm, send that
// content to an external LLM provider — a fully open CORS policy would let
// any web page a developer happens to have open in another tab drive that
// from their own browser, with no consent step ("drive-by localhost").
// Restricting to the actual client origin (configurable, since the client
// dev server's port is the one thing that might legitimately change) closes
// that off: the browser's CORS preflight rejects the cross-origin request
// before it ever reaches a route handler.
export const CLIENT_ORIGIN = process.env.UI_CLIENT_ORIGIN || 'http://localhost:3000';

const port = Number(process.env.PORT) || 4000;
// Bind loopback unless HOST says otherwise (#277). This server runs CLI
// commands, browses the filesystem and writes source files, and
// `listen(port)` alone binds 0.0.0.0, which on a host with a public IP puts
// all of that on the internet. Exposing it is an explicit opt-in — and as
// of #278 it is refused outright unless a GitHub login is configured.
const host = process.env.HOST || '127.0.0.1';

// Whether a GitHub session is required, and how one is obtained, is
// resolved once, here, from the environment (see auth.mjs for the rules).
// A configuration the server must not run with — exposed without a way to
// log in, the e2e test login left on in production, OAuth configured with
// an empty allowlist — throws, and the process exits rather than starting
// in an unsafe state.
let auth;
try {
  auth = createAuth(resolveAuthConfig(process.env, { host, port, clientOrigin: CLIENT_ORIGIN }));
} catch (e) {
  if (e instanceof AuthConfigError && isEntrypoint()) {
    console.error(`\nConstruct UI server refused to start:\n\n  ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

const app = express();
// `credentials: true` is required for the session cookie to survive the
// cross-origin hop from the Next.js client (:3000) to this server (:4000).
// It is exactly why `origin` must stay a single, specific origin rather
// than `*` — a credentialed wildcard is both rejected by browsers and the
// thing that would make a drive-by page able to mint or use a session.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

function respond(res, result) {
  res.status(result.httpStatus).json(result);
}

// Public on purpose: returns `{ok:true}` and nothing else. Playwright's
// `webServer` block and any liveness probe poll it before a session can
// exist. It is registered *above* the gate below, so it is the only
// unauthenticated `/api` route by construction rather than by a path
// comparison something could be smuggled past.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Log in / out. Deliberately outside `/api`, and therefore outside the
// gate — you cannot log in through a door that requires being logged in.
auth.mountRoutes(app);

// ---------------------------------------------------------------------------
// THE GATE (#278). Every route below this line requires a valid, signed
// GitHub session when authentication is enabled; `/api/*` answers 401
// without one. Add new routes BELOW this middleware — a route registered
// above it is public, and this API runs CLI commands and writes files.
// ---------------------------------------------------------------------------
app.use('/api', auth.requireSession);

// Read-only. Returns the CLI's *real* help/usage text, imported directly
// from the same source modules bin/construct.mjs and the REPL use (see
// src/usage.mjs and src/repl.mjs's exported HELP_TOPICS/TOPIC_ORDER/
// getTopLevelHelpText) — never a hand-copied duplicate — so the UI's Help
// page can render the CLI reference from the exact same source of truth
// as `construct` (no args) and `construct repl`'s `help`/`help <topic>`.
app.get('/api/help', (req, res) => {
  res.json({
    usage: USAGE,
    topLevelHelp: getTopLevelHelpText(),
    topics: TOPIC_ORDER,
    helpTopics: HELP_TOPICS,
  });
});

// `findProjectRoot` (src/config.mjs) is the exact same upward-search
// `getRoot` (src/cli.mjs) uses to resolve every command's working root —
// walks up from the given directory looking for the nearest
// `architecture.yml`, falling back to null if none is found all the way to
// the filesystem root. Reusing it here (rather than e.g. a plain
// `fs.existsSync(path.join(dir, 'architecture.yml'))`) means "valid" here
// means exactly what "valid" means when a command actually runs: a
// subdirectory of an existing Construct project counts (matches --dir's
// monorepo support), but an arbitrary directory with no architecture.yml
// anywhere above it does not, and must be `init`-ed first.
function projectStatusFor(projectDir) {
  const resolvedProjectRoot = findProjectRoot(projectDir);
  return {
    resolvedProjectRoot,
    valid: resolvedProjectRoot !== null,
    needsInit: resolvedProjectRoot === null,
  };
}

app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  res.json({ ...settings, ...projectStatusFor(settings.projectDir) });
});

app.post('/api/settings', (req, res) => {
  try {
    const settings = updateSettings(req.body || {});
    res.json({ ...settings, ...projectStatusFor(settings.projectDir) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// #223: allowlisted, directories-only folder browser for the project picker.
// All logic/security lives in src/dir-browser.mjs (+ ./dirBrowse.mjs adapter);
// roots come from settings (default: home + current project's parent).
app.get('/api/fs/browse', (req, res) => {
  const { status, body } = handleBrowse(req.query, {
    origin: req.get('origin'),
    clientOrigin: CLIENT_ORIGIN,
    roots: getBrowseRoots(),
  });
  res.status(status).json(body);
});

// Initializes a Construct project (architecture.yml + AGENTS.md + a `core`
// feature) at the *currently selected* project directory — the same
// `init` function `construct init` runs, called in-process like every
// other command endpoint. Exists so the frontend's "this isn't a Construct
// project yet" state (see projectStatusFor above) has somewhere to send the
// user other than a dead end: pick a directory in Settings, then either
// select an existing project or press "Initialize Construct here".
app.post('/api/init', async (req, res) => {
  const { projectDir } = getSettings();
  const result = await runCapturing(() => init([projectDir]));
  const settings = getSettings();
  res.status(result.httpStatus).json({ ...result, ...settings, ...projectStatusFor(settings.projectDir) });
});

// create feature <name> | create layer <name> --feature f --layers l1,l2 | create <layer> <name> --feature f
app.post('/api/create', async (req, res) => {
  const { kind, name, feature, layer, layers, useLlm } = req.body || {};
  let args;
  if (kind === 'feature') {
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    args = ['feature', name];
  } else if (kind === 'layer') {
    if (!name || !feature || !layers?.length) return res.status(400).json({ ok: false, error: 'name, feature, and a non-empty layers[] are required' });
    args = ['layer', name, '--feature', feature, '--layers', layers.join(',')];
  } else if (kind === 'single') {
    if (!name || !feature || !layer) return res.status(400).json({ ok: false, error: 'name, feature, and layer are required' });
    args = [layer, name, '--feature', feature];
  } else {
    return res.status(400).json({ ok: false, error: 'kind must be "feature", "layer", or "single"' });
  }
  // LLM use is opt-in PER RUN (#109): Settings only says WHICH provider a
  // capability uses; nothing is called unless the request itself asks
  // (`useLlm: true`). A "feature" has no fillable body, so it never applies.
  if (useLlm === true && kind !== 'feature') args.push('--llm', getSettings().llmProviders.createFill);
  respond(res, await runCapturing(() => create(withDir(args))));
});

// refactor move <name> --feature f --from l1 --to l2 | refactor rename <name> <newName> --feature f --layer l
app.post('/api/refactor', async (req, res) => {
  const { action, name, newName, feature, from, to, layer } = req.body || {};
  let args;
  if (action === 'move') {
    if (!name || !feature || !from || !to) return res.status(400).json({ ok: false, error: 'name, feature, from, and to are required' });
    args = ['move', name, '--feature', feature, '--from', from, '--to', to];
  } else if (action === 'rename') {
    if (!name || !newName || !feature || !layer) return res.status(400).json({ ok: false, error: 'name, newName, feature, and layer are required' });
    args = ['rename', name, newName, '--feature', feature, '--layer', layer];
  } else {
    return res.status(400).json({ ok: false, error: 'action must be "move" or "rename"' });
  }
  respond(res, await runCapturing(() => refactor(withDir(args))));
});

// research summarize [--feature ...] [--format ...] [--since ...] | research doctor
app.post('/api/research', async (req, res) => {
  const { action, feature, format, since } = req.body || {};
  let args;
  if (action === 'summarize') {
    args = ['summarize'];
    if (feature) args.push('--feature', feature);
    if (format) args.push('--format', format);
    if (since) args.push('--since', since);
  } else if (action === 'doctor') {
    args = ['doctor'];
  } else {
    return res.status(400).json({ ok: false, error: 'action must be "summarize" or "doctor"' });
  }
  respond(res, await runCapturing(() => research(withDir(args))));
});

// import <name> --feature f --layers l1,l2 --from path [--llm p] | import --plan path [--llm p]
app.post('/api/import', async (req, res) => {
  const { mode, name, feature, layers, from, llm, useLlm, planPath } = req.body || {};
  let args;
  if (mode === 'unit') {
    if (!name || !feature || !layers?.length || !from) return res.status(400).json({ ok: false, error: 'name, feature, a non-empty layers[], and from are required' });
    args = [name, '--feature', feature, '--layers', layers.join(','), '--from', from];
  } else if (mode === 'plan') {
    if (!planPath) return res.status(400).json({ ok: false, error: 'planPath is required' });
    args = ['--plan', planPath];
  } else {
    return res.status(400).json({ ok: false, error: 'mode must be "unit" or "plan"' });
  }
  // An explicit `llm` provider name (direct API use) still wins; the UI sends
  // `useLlm: true` instead and the provider comes from Settings.importFill.
  const importLlm = llm || (useLlm === true ? getSettings().llmProviders.importFill : undefined);
  if (importLlm) args.push('--llm', importLlm);
  respond(res, await runCapturing(() => importCommand(withDir(args))));
});

// ---------------------------------------------------------------------------
// Ollama (Epic 6.1, #97) — detect/list/pull/remove models through Ollama's
// own local HTTP API (see ollama.mjs). Read-only detection/listing never
// throws a hard error to the client; a non-running daemon is a normal state
// the UI renders (install guidance), not a 500.

app.get('/api/ollama/status', async (req, res) => {
  res.json(await getOllamaStatus());
});

app.get('/api/ollama/models', async (req, res) => {
  try {
    res.json({ models: await listOllamaModels() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Streams Ollama's own newline-delimited JSON pull-progress events straight
// through to the browser as they arrive (see startOllamaPull's comment) —
// the client reads this response body incrementally rather than waiting for
// it to finish, so a multi-GB pull shows live progress instead of a blocked
// spinner.
app.post('/api/ollama/pull', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  try {
    const upstream = await startOllamaPull(name);
    res.setHeader('Content-Type', 'application/x-ndjson');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.delete('/api/ollama/models/:name', async (req, res) => {
  try {
    res.json(await removeOllamaModel(req.params.name));
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Pages editor (epic #48: #49 pages browser, #50 JSX tree, #52 snippet
// save-back, #53 props inspector, #54 auto-map). All of this is read/write
// only within features/<feature>/pages/ — see pagesEditor.mjs's
// resolvePageFile for the #56 scope guard, applied on every route below,
// and checkEnforcement for the #56 pre-save architecture-rule gate applied
// on every route that writes.
function currentRoot() {
  const { projectDir } = getSettings();
  const root = findProjectRoot(projectDir);
  if (!root) throw new PagesEditorError('No Construct project found for the current project directory — set one in Settings first.', { status: 400 });
  return root;
}

function handlePagesEditorError(res, e) {
  if (e instanceof PagesEditorError) {
    return res.status(e.status).json({ ok: false, error: e.message, violations: e.violations });
  }
  return res.status(500).json({ ok: false, error: e.message });
}

app.get('/api/pages/features', (req, res) => {
  try {
    res.json({ features: listFeatures(currentRoot()) });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/pages', (req, res) => {
  try {
    const { feature } = req.query;
    if (!feature) return res.status(400).json({ ok: false, error: 'feature is required' });
    res.json({ feature, files: listPages(currentRoot(), feature) });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/pages/tree', (req, res) => {
  try {
    const { feature, file } = req.query;
    const root = currentRoot();
    const { absPath, relPath } = resolvePageFile(root, feature, file);
    const source = fs.readFileSync(absPath, 'utf8');
    pageChangeTracker.observe(relPath, source); // #224 baseline: what the editor is showing
    res.json(serializeTree(source));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Read-only source view: the whole page file + TypeScript/architecture
// diagnostics (core src/engine/diagnostics.mjs), scoped by resolvePageFile.
app.get('/api/pages/source', (req, res) => {
  try {
    const { feature, file } = req.query;
    res.json(readPageSource(currentRoot(), feature, file));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/pages/node', (req, res) => {
  try {
    const { feature, file, nodeId } = req.query;
    const root = currentRoot();
    const { absPath } = resolvePageFile(root, feature, file);
    res.json(getNodeSnippet(fs.readFileSync(absPath, 'utf8'), nodeId));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Shared by both the raw-snippet save (#52) and the props-form save (#53):
// patch in memory, run #56's enforcement gate against the patched content,
// write to disk only if it's clean, and always return the up-to-date tree +
// hash so the client can refresh without a second round trip.
function saveAndRespond(res, root, relPath, absPath, patched) {
  const enforcement = checkEnforcement(root, relPath, patched);
  if (!enforcement.ok) {
    return res.status(422).json({ ok: false, error: 'Save blocked: violates architecture rules.', violations: enforcement.violations });
  }
  const isNew = !fs.existsSync(absPath);
  fs.writeFileSync(absPath, patched);
  adoptOwnWrite(relPath, patched);
  res.json({ ok: true, violations: enforcement.violations, autoCommit: afterSave(root, relPath, isNew), ...serializeTree(patched) });
}

// #283 — every save in the Cockpit goes through here on its way to git. Deliberately best-effort:
// a commit that cannot be made (not a git repo, a mid-rebase tree, a git binary that is not there)
// must never turn a successful save into a failed request. The save already happened; the worst
// case is history that is quieter than the user expected, and the response says so.
function afterSave(root, relPath, isNew = false) {
  try {
    return recordSave(root, relPath, { kind: isNew ? 'add' : 'update' });
  } catch (e) {
    return { committed: false, status: 'error', error: e.message };
  }
}

// #224 — last external change to a page file, as a diff. The client polls
// this; each poll observes the file, so a write from an agent/CLI/other
// editor (anything that didn't go through saveAndRespond) shows up here.
// Same resolvePageFile scope guard as every other route.
app.get('/api/pages/changes', (req, res) => {
  try {
    const { feature, file } = req.query;
    const { absPath, relPath } = resolvePageFile(currentRoot(), feature, file);
    res.json({ ok: true, ...describePageChange(absPath, relPath) });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/changes/dismiss', (req, res) => {
  try {
    const { feature, file } = req.body || {};
    const { relPath } = resolvePageFile(currentRoot(), feature, file);
    pageChangeTracker.dismiss(relPath);
    res.json({ ok: true });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/node', (req, res) => {
  try {
    const { feature, file, nodeId, snippet, contentHash } = req.body || {};
    if (!nodeId || typeof snippet !== 'string') return res.status(400).json({ ok: false, error: 'nodeId and snippet are required' });
    const root = currentRoot();
    const { absPath, relPath } = resolvePageFile(root, feature, file);
    const source = fs.readFileSync(absPath, 'utf8');
    const patched = patchNode(source, nodeId, snippet, contentHash);
    saveAndRespond(res, root, relPath, absPath, patched);
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/pages/props', (req, res) => {
  try {
    const { feature, file, nodeId } = req.query;
    const root = currentRoot();
    const { absPath } = resolvePageFile(root, feature, file);
    res.json(getNodeProps(fs.readFileSync(absPath, 'utf8'), nodeId));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/props', (req, res) => {
  try {
    const { feature, file, nodeId, propName, kind, value, contentHash, index } = req.body || {};
    // A spread prop has no name (it's `{...expr}`, not `name={expr}`) —
    // identified by `index` instead (#77 follow-up to #53).
    if (!nodeId || !kind || (kind !== 'spread' && !propName)) {
      return res.status(400).json({ ok: false, error: 'nodeId, kind, and (for non-spread props) propName are required' });
    }
    const root = currentRoot();
    const { absPath, relPath } = resolvePageFile(root, feature, file);
    const source = fs.readFileSync(absPath, 'utf8');
    if (contentHash && hashOf(source) !== contentHash) {
      return res.status(409).json({ ok: false, error: 'The file changed on disk since this was loaded — reload the tree and try again.' });
    }
    const attrSnippet = buildAttributeSnippet(source, nodeId, propName, kind, value, index);
    const patched = patchNode(source, nodeId, attrSnippet, contentHash);
    saveAndRespond(res, root, relPath, absPath, patched);
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/pages/unmapped', (req, res) => {
  try {
    const { feature, file, nodeId } = req.query;
    const root = currentRoot();
    const { absPath } = resolvePageFile(root, feature, file);
    res.json(findUnmappedProps(fs.readFileSync(absPath, 'utf8'), nodeId, root, absPath));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// #223: which page-scope names flow into which of this element's props (path-scoped to pages/;
// cross-origin browser reads are refused by the global CORS policy above).
app.get('/api/pages/scope-links', (req, res) => {
  try {
    const { feature, file, nodeId } = req.query;
    const root = currentRoot();
    const { absPath } = resolvePageFile(root, feature, file);
    res.json(getScopeLinks(fs.readFileSync(absPath, 'utf8'), nodeId, root, absPath));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// #321 click-to-navigate. Both routes sit below the session gate. They return only project-root-relative
// paths and never take a path to read from the client: the first view is a page (the editor's own pages/
// guard), every later hop is a reference in a file, resolved server-side (see projectNav.mjs).
app.get('/api/nav/page', (req, res) => {
  try {
    const { feature, file } = req.query;
    res.json(viewPage(currentRoot(), feature, file));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/nav/open', (req, res) => {
  try {
    const { from, ref, start } = req.body || {};
    res.json(openReference(currentRoot(), from, ref, start));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/automap', (req, res) => {
  try {
    const { feature, file, nodeId, propNames, contentHash } = req.body || {};
    if (!nodeId || !Array.isArray(propNames) || propNames.length === 0) {
      return res.status(400).json({ ok: false, error: 'nodeId and a non-empty propNames[] are required' });
    }
    const root = currentRoot();
    const { absPath, relPath } = resolvePageFile(root, feature, file);
    const source = fs.readFileSync(absPath, 'utf8');
    if (contentHash && hashOf(source) !== contentHash) {
      return res.status(409).json({ ok: false, error: 'The file changed on disk since this was loaded — reload the tree and try again.' });
    }
    const patched = applyAutoMap(source, nodeId, propNames);
    saveAndRespond(res, root, relPath, absPath, patched);
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Ticket F.1 (#120, epic #119) — the visual composer's live parse. POST
// (not GET) since a snippet's text can be long/contain query-unsafe
// characters; no `feature`/`file`/disk access at all here — pure text in,
// tree out, so the graph the client renders is always derived fresh from
// whatever text is currently in the editor, never a cached/persisted
// layout.
app.post('/api/pages/snippet-tree', (req, res) => {
  try {
    const { snippet } = req.body || {};
    if (typeof snippet !== 'string') return res.status(400).json({ ok: false, error: 'snippet is required' });
    res.json(parseSnippetToTree(snippet));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Ticket F.2 (#121, epic #119) — the visual composer's wire-rewrite. Body
// carries the snippet's own current text (not feature/file) plus the wire's
// endpoints; the response is the new snippet text (or a rejection reason),
// never a disk write — the client hands the result to the existing
// save-back-to-source + diff-preview flow itself.
app.post('/api/pages/snippet-rewire', (req, res) => {
  try {
    const { snippet, parentId, propName, fromChildId, toChildId } = req.body || {};
    if (typeof snippet !== 'string' || !parentId || !propName || !fromChildId || !toChildId) {
      return res.status(400).json({ ok: false, error: 'snippet, parentId, propName, fromChildId, and toChildId are required' });
    }
    res.json(rewireWireInSnippet(snippet, { parentId, propName, fromChildId, toChildId }));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Ticket F.3 (#122, epic #119) — the visual composer's structural node
// edits. Same contract as snippet-rewire above: the snippet's own current
// text in, a rewritten snippet (or a rejection reason) out, never a disk
// write here — the client hands the result to the existing save-back-to-
// source + diff-preview flow itself.
app.post('/api/pages/snippet-remove-node', (req, res) => {
  try {
    const { snippet, nodeId } = req.body || {};
    if (typeof snippet !== 'string' || !nodeId) return res.status(400).json({ ok: false, error: 'snippet and nodeId are required' });
    res.json(removeNodeInSnippet(snippet, nodeId));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/snippet-move-node', (req, res) => {
  try {
    const { snippet, nodeId, direction } = req.body || {};
    if (typeof snippet !== 'string' || !nodeId || !direction) {
      return res.status(400).json({ ok: false, error: 'snippet, nodeId, and direction are required' });
    }
    res.json(moveNodeInSnippet(snippet, nodeId, direction));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.post('/api/pages/snippet-add-child', (req, res) => {
  try {
    const { snippet, parentId } = req.body || {};
    if (typeof snippet !== 'string' || !parentId) return res.status(400).json({ ok: false, error: 'snippet and parentId are required' });
    res.json(addChildInSnippet(snippet, parentId));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Workflows viewer (epic #57: #59 screen, #60 extraction). Read-only, scoped
// to features/<feature>/workflows/ (see workflowsViewer.mjs's
// resolveWorkflowFile). Machines are re-extracted from real source on every
// request; nothing is stored.
app.get('/api/workflows/features', (req, res) => {
  try {
    res.json({ features: listWorkflowFeatures(currentRoot()) });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/workflows', (req, res) => {
  try {
    const { feature } = req.query;
    if (!feature) return res.status(400).json({ ok: false, error: 'feature is required' });
    res.json({ feature, files: listWorkflowFiles(currentRoot(), feature) });
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

app.get('/api/workflows/machines', (req, res) => {
  try {
    const { feature, file } = req.query;
    res.json(readWorkflowMachines(currentRoot(), feature, file));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// Epic #185: the same file's machines explained in plain English + scenarios
// + health findings, re-derived from the real source on every request.
app.get('/api/workflows/narrative', (req, res) => {
  try {
    const { feature, file } = req.query;
    res.json(readWorkflowNarrative(currentRoot(), feature, file));
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// #61: POST body { feature, file, machine, op, ...opArgs, commit?, contentHash? }.
// commit=false -> patched source for the diff preview (nothing written);
// commit=true -> re-apply, hash check, enforcement gate, write.
app.post('/api/workflows/edit', (req, res) => {
  try {
    const { feature, file, commit, contentHash, ...edit } = req.body || {};
    const root = currentRoot();
    const result = editWorkflowFile(root, feature, file, edit, { commit: !!commit, contentHash });
    res.json(result.savedPath ? { ...result, autoCommit: afterSave(root, result.savedPath) } : result);
  } catch (e) {
    handlePagesEditorError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Commit-on-save (#283). The deterministic message assembly lives in core
// (src/engine/commitMessage.mjs); these routes are the policy surface the
// Cockpit drives: what mode we are in, what the session branch is, and the
// one question the feature is allowed to ask the user (a dirty tree at
// session start). Read ui/server/src/autoCommit.mjs for the rules.
function handleAutoCommitError(res, e) {
  if (e instanceof AutoCommitError) return res.status(e.status).json({ ok: false, error: e.message });
  return handlePagesEditorError(res, e);
}

app.get('/api/git/session', (req, res) => {
  try {
    res.json(getSessionStatus(currentRoot()));
  } catch (e) {
    handleAutoCommitError(res, e);
  }
});

app.post('/api/git/config', (req, res) => {
  try {
    res.json({ ok: true, config: updateCommitConfig(req.body || {}) });
  } catch (e) {
    handleAutoCommitError(res, e);
  }
});

// The answer to "you had uncommitted changes when this session started — carry them onto the
// session branch, or stash them?". `remember` keeps the answer for this project so a user who
// always answers the same way is not asked forever (#283).
app.post('/api/git/dirty-answer', (req, res) => {
  try {
    const { answer, remember } = req.body || {};
    res.json({ ok: true, result: answerDirtyPrompt(currentRoot(), { answer, remember: !!remember }) });
  } catch (e) {
    handleAutoCommitError(res, e);
  }
});

// Commit whatever is pending right now: the Commit button in `manual` mode, and the "don't wait
// for the coalescing window" action in `coalesce`.
app.post('/api/git/commit', (req, res) => {
  try {
    res.json({ ok: true, result: flushSession(currentRoot()) });
  } catch (e) {
    handleAutoCommitError(res, e);
  }
});

// Optional: tell the session which plan/ticket it is working from, so the branch is named after
// the work and the commit body can say what was planned versus not (#286's planTouches).
app.post('/api/git/plan', (req, res) => {
  try {
    const { plan, planTitle } = req.body || {};
    res.json({ ok: true, ...setSessionPlan(currentRoot(), { plan: plan || null, planTitle: planTitle || '' }) });
  } catch (e) {
    handleAutoCommitError(res, e);
  }
});

// ---------------------------------------------------------------------------
// Unit summaries (deterministic, LLM-free; src/engine/unitSummary.mjs). Read-only, scoped to the
// current project root. /api/features* are thin aliases of the feature-kind unit calls.
function sendUnits(res, fn) {
  try {
    const { status, body } = fn(currentRoot());
    res.status(status).json(body);
  } catch (e) {
    handlePagesEditorError(res, e);
  }
}
app.get('/api/units', (req, res) => sendUnits(res, (root) => unitsIndex(root, req.query)));
app.get('/api/units/summary', (req, res) => sendUnits(res, (root) => unitSummary(root, req.query)));
app.get('/api/features', (req, res) => sendUnits(res, (root) => featuresIndex(root)));
app.get('/api/features/:name/summary', (req, res) => sendUnits(res, (root) => featureSummary(root, req.params.name, req.query)));

// Cockpit drawer: Diagnostics (construct validate for the current project) and
// Logs (bounded in-memory ring of recent command/validate output). Both are
// read-only and refuse a foreign browser origin.
app.get('/api/validate', (req, res) => {
  const { status, body } = handleValidate({ origin: req.get('origin'), clientOrigin: CLIENT_ORIGIN, projectDir: getSettings().projectDir });
  res.status(status).json(body);
});

app.get('/api/logs', (req, res) => {
  const { status, body } = handleLogs(req.query, { origin: req.get('origin'), clientOrigin: CLIENT_ORIGIN });
  res.status(status).json(body);
});

// #292: the Processes drawer. Registered below the gate like every other
// `/api` route; the WebSocket (createUiServer) takes the same `auth`.
export const processesService = createProcessesService({ getProjectDir: () => getSettings().projectDir });
app.use('/api/processes', createProcessesRouter(processesService));

// #312/#313: Review mode (read-only). Registered below the gate like every other `/api` route. The
// repository is always the current project's -- the client sends branch names only, and each is
// checked against `git for-each-ref` of that repository (reviewRefs.mjs). The synchronous PR-health
// engine runs in a child process per job (reviewJobs.mjs), never on this request thread.
export const reviewJobs = createReviewJobs();
app.use('/api/review', createReviewRouter({
  jobs: reviewJobs,
  getRoot: () => {
    const root = findProjectRoot(getSettings().projectDir);
    return root ? { ok: true, root } : { ok: false, error: 'No Construct project found for the current project directory. Pick a project first.' };
  },
}));

/** True when this file is the process entry point (`npm start`), false when
 * it is imported — by a test, or by anything else that wants the app
 * without a listener. */
function isEntrypoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

/** The Express app and the resolved auth surface, exported so tests can
 * exercise the real route table (and the real gate) without a listener. */
export { app, auth };

/** Build the HTTP server with the wizard WebSocket attached. The socket
 * gets the same `auth` object the REST gate uses, so it can never be the
 * more permissive of the two. */
export function createUiServer() {
  const server = http.createServer(app);
  attachWizardSocket(server, '/ws/wizard', CLIENT_ORIGIN, auth);
  attachProcessesSocket(server, processesService, '/ws/processes', CLIENT_ORIGIN, auth);
  refuseUnknownUpgrades(server, ['/ws/wizard', '/ws/processes']);
  return server;
}

export function start() {
  const server = createUiServer();
  server.listen(port, host, () => {
    console.log(`Construct UI server listening on http://${host}:${port}`);
    for (const line of auth.describeStartup()) {
      (line.level === 'warn' ? console.warn : console.log)(line.level === 'warn' ? `WARNING: ${line.text}` : line.text);
    }
    if (!isLoopbackHost(host)) {
      console.warn(`Bound to ${host}, not loopback — this server is reachable from other machines (#277).`);
    }
  });
  return server;
}

if (isEntrypoint()) start();
