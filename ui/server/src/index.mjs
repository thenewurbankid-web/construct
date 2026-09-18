// Construct UI backend — a small Express server that calls the core CLI's
// exported functions (create/refactor/research/importCommand from
// src/cli.mjs) directly, in-process. It never shells out to the `construct`
// binary: this is the same Node project, same module graph, so the real
// functions are imported and called exactly as bin/construct.mjs does.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import { create, refactor, research, importCommand, init } from '../../../src/cli.mjs';
import { findProjectRoot } from '../../../src/config.mjs';
import { USAGE } from '../../../src/usage.mjs';
import { HELP_TOPICS, TOPIC_ORDER, getTopLevelHelpText } from '../../../src/repl.mjs';
import { getSettings, updateSettings } from './settings.mjs';
import { runCapturing, withDir } from './commandRunner.mjs';
import { attachWizardSocket } from './wizardSocket.mjs';
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
  applyAutoMap,
  checkEnforcement,
  hashOf,
  parseSnippetToTree,
  rewireWireInSnippet,
} from './pagesEditor.mjs';

const app = express();
app.use(cors());
app.use(express.json());

function respond(res, result) {
  res.status(result.httpStatus).json(result);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

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
  const { kind, name, feature, layer, layers } = req.body || {};
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
  const { mode, name, feature, layers, from, llm, planPath } = req.body || {};
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
  if (llm) args.push('--llm', llm);
  respond(res, await runCapturing(() => importCommand(withDir(args))));
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
    const { absPath } = resolvePageFile(root, feature, file);
    res.json(serializeTree(fs.readFileSync(absPath, 'utf8')));
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
  fs.writeFileSync(absPath, patched);
  res.json({ ok: true, violations: enforcement.violations, ...serializeTree(patched) });
}

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

const port = Number(process.env.PORT) || 4000;
const server = http.createServer(app);
attachWizardSocket(server);

server.listen(port, () => {
  console.log(`Construct UI server listening on http://localhost:${port}`);
});
