// Module 2 — Separation of Concerns Enforcer (Epics 2.1 and 2.2).
// Feature-slice boundary checks (SLICE-001, SLICE-002) and module-cohesion
// checks (MODULE-001, SOC-001, DRY-001). All violations are built through
// makeViolation() from ./diagnostics.mjs with module: 'separation-of-concerns'.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, DEFAULT_RULES } from './config.mjs';
import { walk, rel } from './fs.mjs';
import { makeViolation } from './diagnostics.mjs';
import { exceptionApplies } from './exceptions.mjs';

const ext = new Set(['.ts', '.tsx', '.js', '.jsx']);
export const LAYER_FOLDERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const LAYER_FOLDER_SET = new Set(LAYER_FOLDERS);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripExt = (p) => p.replace(/\.(tsx|ts|jsx|js)$/, '');

// ---------------------------------------------------------------------------
// Config-driven severity/exceptions, wired through the shared diagnostics
// contract.
// ---------------------------------------------------------------------------
function severityFor(config, rule) {
  const entry = config.rules?.[rule];
  if (typeof entry === 'string') return entry;
  return entry?.severity ?? DEFAULT_RULES[rule]?.severity ?? 'error';
}

function pushViolation(config, out, opts) {
  const severity = severityFor(config, opts.rule);
  if (severity === 'off' || exceptionApplies(config, opts.rule, opts.file)) return;
  out.push(makeViolation({ module: 'separation-of-concerns', severity, ...opts }));
}

function featuresRootOf(config) {
  return config.features?.root || 'features';
}

function listFeatureDirs(root, featuresRoot) {
  const base = path.join(root, featuresRoot);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// ---------------------------------------------------------------------------
// index.ts export parsing — shared by SLICE-002 detection, isPublicPath, and
// the API composer (src/api-composer.mjs) which imports parseIndexExports.
// ---------------------------------------------------------------------------
const EXPORT_FROM_RE = /export\s+(type\s+)?(\*|\{[^}]*\})\s*from\s*(['"])(.+?)\3\s*;?/g;

export function parseIndexExports(source) {
  const out = [];
  for (const m of source.matchAll(EXPORT_FROM_RE)) {
    out.push({
      specifier: m[4],
      isWildcard: m[2] === '*',
      isType: Boolean(m[1]),
      line: source.slice(0, m.index).split('\n').length,
      raw: m[0].trim(),
    });
  }
  return out;
}

/**
 * isPublicPath(root, filePath) -> boolean
 * A path is public only if it is re-exported — directly, or via `export *` —
 * from its feature's index.ts. Paths outside the configured features root are
 * considered "not applicable" and return true. Stable signature: reused by
 * other Construct modules (e.g. the API composer) to classify files.
 */
export function isPublicPath(root, filePath) {
  const config = loadConfig(root);
  const featuresRoot = featuresRootOf(config);
  const relFile = path.isAbsolute(filePath) ? rel(root, filePath) : filePath.replaceAll(path.sep, '/');

  const m = relFile.match(new RegExp(`^${escapeRegex(featuresRoot)}/([^/]+)/(.*)$`));
  if (!m) return true; // not under a feature slice — no restriction applies
  const [, featureName, restPath] = m;
  const restNoExt = stripExt(restPath);
  if (restNoExt === 'index') return true; // the index.ts itself

  const indexPath = path.join(root, featuresRoot, featureName, 'index.ts');
  if (!fs.existsSync(indexPath)) return false;
  const exportsList = parseIndexExports(fs.readFileSync(indexPath, 'utf8'));

  return exportsList.some((e) => {
    const resolved = path.posix.normalize(e.specifier.replace(/^\.\//, ''));
    if (resolved === restNoExt) return true;
    if (e.isWildcard && (restNoExt === resolved || restNoExt.startsWith(resolved + '/'))) return true;
    return false;
  });
}

function resolveSpecifier(currentRelFile, spec, featuresRoot) {
  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(currentRelFile);
    return path.posix.normalize(path.posix.join(dir, spec));
  }
  if (spec.startsWith('@features/')) {
    return path.posix.normalize(path.posix.join(featuresRoot, spec.slice('@features/'.length)));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Epic 2.1 — Feature Slice Boundary Enforcer
// ---------------------------------------------------------------------------
function checkSkeleton(config, out, root, featuresRoot, name) {
  const featureDir = path.join(root, featuresRoot, name);
  const missing = LAYER_FOLDERS.filter((f) => !fs.existsSync(path.join(featureDir, f)));
  if (!missing.length) return;
  pushViolation(config, out, {
    rule: 'SLICE-001',
    file: `${featuresRoot}/${name}/`,
    line: 1,
    message: `Feature "${name}" is missing expected folder(s): ${missing.join(', ')}.`,
    why: 'A feature slice must expose a full, predictable set of layer folders so ownership stays unambiguous.',
    expected: missing.map((f) => `${featuresRoot}/${name}/${f}/`),
    suggestedFix: `Run: construct feature create ${name}`,
  });
}

const IMPORT_RE = /(?:import\s+(?:type\s+)?[\s\S]*?from\s*|import\s*\()(['"])(.*?)\1/g;

function checkCrossFeatureImports(config, out, root, featuresRoot, relFile, src) {
  const currentFeature = relFile.match(new RegExp(`^${escapeRegex(featuresRoot)}/([^/]+)/`))?.[1];
  if (!currentFeature) return;
  for (const m of src.matchAll(IMPORT_RE)) {
    const resolved = resolveSpecifier(relFile, m[2], featuresRoot);
    if (!resolved) continue;
    const other = resolved.match(new RegExp(`^${escapeRegex(featuresRoot)}/([^/]+)/(.*)$`));
    if (!other) continue;
    const [, otherFeature, restPath] = other;
    if (otherFeature === currentFeature) continue;
    if (isPublicPath(root, resolved)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    pushViolation(config, out, {
      rule: 'SLICE-002',
      file: relFile,
      line,
      message: `Cross-feature import reaches into "${otherFeature}" internals (${restPath}).`,
      why: 'Features may only consume another feature through its public index API.',
      expected: [`${featuresRoot}/${otherFeature}/index.ts`],
      suggestedFix: `Import from ${featuresRoot}/${otherFeature}/index.ts instead — export the needed symbol there first if it isn't already public.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Epic 2.2 — Module Cohesion Enforcer
// ---------------------------------------------------------------------------
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * countPrimaryExports(source) -> [{name, line}]
 * Regex-based top-level exported function/class/const/let/var counter.
 * Re-exports (`export * from`, `export {..} from`) never count — they
 * aggregate an API, they don't declare a new responsibility in this file.
 */
export function countPrimaryExports(source) {
  const src = source.replace(/export\s+(type\s+)?(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*(['"])[^'"]*\3\s*;?/g, '');
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;
  const results = [];

  for (const m of src.matchAll(/export\s+default\s+(?:async\s+)?(function\*?|class)\s*([A-Za-z_$][\w$]*)?/g)) {
    results.push({ name: m[2] || 'default', line: lineAt(m.index) });
  }
  for (const m of src.matchAll(/export\s+default\s+(?!(?:async\s+)?(?:function|class)\b)([^\n;]+);?/g)) {
    results.push({ name: 'default', line: lineAt(m.index) });
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) {
    results.push({ name: m[2], line: lineAt(m.index) });
  }
  for (const m of src.matchAll(/export\s+(const|let|var)\s+([^;\n]+)/g)) {
    const line = lineAt(m.index);
    for (const part of splitTopLevelCommas(m[2])) {
      const nm = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (nm) results.push({ name: nm[1], line });
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    const line = lineAt(m.index);
    for (const item of m[1].split(',')) {
      const token = item.trim();
      if (!token) continue;
      const asMatch = token.match(/as\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : token.split(/\s+/)[0];
      if (name) results.push({ name, line });
    }
  }
  return results;
}

function checkModuleCohesion(config, out, relFile, src) {
  // Threshold is configurable via architecture.yml as a nested field on the
  // rule's own entry, per config.mjs's uniform rules-map contract:
  //   rules:
  //     MODULE-001:
  //       threshold: 5
  const threshold = Number(config.rules?.['MODULE-001']?.threshold) || 3;
  const exported = countPrimaryExports(src);
  if (exported.length <= threshold) return;
  const overflow = exported.slice(threshold).map((e) => e.name);
  pushViolation(config, out, {
    rule: 'MODULE-001',
    file: relFile,
    line: exported[0]?.line || 1,
    message: `File declares ${exported.length} primary exports (threshold ${threshold}).`,
    why: 'One primary module per file keeps files single-purpose and easy to navigate.',
    expected: [`${threshold} or fewer primary exports per file`],
    suggestedFix: `Split out ${overflow.join(', ')} into their own file(s).`,
  });
}

function checkOwnership(config, out, root, featuresRoot, featureName) {
  const featureDir = path.join(root, featuresRoot, featureName);
  for (const p of walk(featureDir).filter((p) => ext.has(path.extname(p)))) {
    const relToFeature = rel(featureDir, p);
    const segments = relToFeature.split('/');
    const top = segments[0];
    const relFull = rel(root, p);
    if (segments.length === 1) {
      if (top === 'index.ts' || top === 'types.ts') continue;
      pushViolation(config, out, {
        rule: 'SOC-001',
        file: relFull,
        line: 1,
        message: `File "${top}" sits directly in the feature root without a recognized role.`,
        why: 'Every responsibility needs an architectural owner.',
        expected: [...LAYER_FOLDERS, 'shared/', 'index.ts', 'types.ts'],
        suggestedFix: `Move ${relFull} into a known layer folder (e.g. ${featuresRoot}/${featureName}/domain/) or ${featuresRoot}/${featureName}/shared/.`,
      });
      continue;
    }
    if (top === 'shared' || LAYER_FOLDER_SET.has(top)) continue;
    pushViolation(config, out, {
      rule: 'SOC-001',
      file: relFull,
      line: 1,
      message: `File is under unrecognized folder "${top}/".`,
      why: 'Every responsibility needs an architectural owner (a known layer folder or an explicit shared/).',
      expected: [...LAYER_FOLDERS, 'shared/'],
      suggestedFix: `Move ${relFull} into one of ${LAYER_FOLDERS.join('/')} or ${featuresRoot}/${featureName}/shared/.`,
    });
  }
}

// DRY-001 — cheap, approximate near-duplicate heuristic. Not a clone detector.
const MIN_BODY_LEN = 60;
const FUNCTION_BLOCK_RE = /(?:function\s*[A-Za-z_$][\w$]*\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g;

function findMatchingBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractFunctionBlocks(src) {
  const blocks = [];
  for (const m of src.matchAll(FUNCTION_BLOCK_RE)) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(src, openIdx);
    if (closeIdx > openIdx) blocks.push({ text: src.slice(openIdx, closeIdx + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return blocks;
}

function normalizeBody(body) {
  return body
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/["'`][^"'`]*["'`]/g, 'STR')
    .replace(/[A-Za-z_$][\w$]*/g, 'ID')
    .replace(/\s+/g, '');
}

function checkDuplication(config, out, root, featuresRoot, files) {
  const bodies = [];
  for (const p of files) {
    const rp = rel(root, p);
    const feature = rp.match(new RegExp(`^${escapeRegex(featuresRoot)}/([^/]+)/`))?.[1];
    if (!feature) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const block of extractFunctionBlocks(src)) {
      const norm = normalizeBody(block.text);
      if (norm.length < MIN_BODY_LEN) continue;
      bodies.push({ feature, file: rp, line: block.line, norm });
    }
  }
  const groups = new Map();
  for (const b of bodies) {
    if (!groups.has(b.norm)) groups.set(b.norm, []);
    groups.get(b.norm).push(b);
  }
  for (const group of groups.values()) {
    if (new Set(group.map((g) => g.feature)).size < 2) continue;
    const [original, ...dupes] = group;
    for (const dup of dupes) {
      pushViolation(config, out, {
        rule: 'DRY-001',
        file: dup.file,
        line: dup.line,
        message: 'Near-identical business logic found in another feature.',
        why: 'Duplicated logic drifts silently and breaks single-source-of-truth for business rules.',
        expected: ['shared/', 'a common domain/service module'],
        suggestedFix: `This looks like a near-duplicate of ${original.file}:${original.line}. Consider extracting the shared logic into a shared/ module.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Single entry point
// ---------------------------------------------------------------------------
export function validateSeparationOfConcerns(root) {
  const config = loadConfig(root);
  const featuresRoot = featuresRootOf(config);
  const out = [];

  if (!fs.existsSync(path.join(root, featuresRoot))) {
    pushViolation(config, out, {
      rule: 'SLICE-001',
      file: `${featuresRoot}/`,
      line: 1,
      message: 'Missing feature root.',
      why: 'Feature slices are mandatory for isolation and ownership.',
      expected: [`${featuresRoot}/<feature>`],
      suggestedFix: 'Run: construct feature create <name>',
    });
    return { violations: out };
  }

  const featureNames = listFeatureDirs(root, featuresRoot);
  for (const name of featureNames) checkSkeleton(config, out, root, featuresRoot, name);

  const featureFiles = walk(root)
    .filter((p) => ext.has(path.extname(p)))
    .filter((p) => rel(root, p).startsWith(featuresRoot + '/'));

  for (const p of featureFiles) {
    const r = rel(root, p);
    const src = fs.readFileSync(p, 'utf8');
    checkCrossFeatureImports(config, out, root, featuresRoot, r, src);
    checkModuleCohesion(config, out, r, src);
  }
  for (const name of featureNames) checkOwnership(config, out, root, featuresRoot, name);
  checkDuplication(config, out, root, featuresRoot, featureFiles);

  return { violations: out };
}
