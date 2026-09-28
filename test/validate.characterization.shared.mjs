// Shared by test/validate.characterization.gen.mjs (regenerates the golden) and
// test/validate.characterization.test.mjs (asserts the current run still matches it) --
// #544, the safety net Rules-2's per-rule catalog migration (#545) is verified against.
//
// Runs `construct validate`'s exact enforcer list (packages/engine/defaultEnforcers.mjs's
// DEFAULT_ENFORCERS, via packages/core/registry.mjs's aggregateValidation -- the same call
// `construct validate` itself makes) over every fixture project under fixtures/ that has its
// own features/ or app/ tree, plus the example/ project, and returns one deterministically
// sorted, path-relative record per fixture so the committed golden survives being checked out
// under a different absolute path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateValidation } from '../packages/core/registry.mjs';
import { DEFAULT_ENFORCERS } from '../packages/engine/defaultEnforcers.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every fixture directory under fixtures/ that looks like a project (has its own features/
 * or app/ tree) -- the ones a real project's enforcers can run over without throwing on a
 * missing layer tree -- plus the example/ dogfood project, sorted for a deterministic order. */
export function characterizationRoots() {
  const fixturesDir = path.join(REPO_ROOT, 'fixtures');
  const projectFixtures = fs.readdirSync(fixturesDir)
    .filter((name) => {
      const dir = path.join(fixturesDir, name);
      if (!fs.statSync(dir).isDirectory()) return false;
      return fs.existsSync(path.join(dir, 'features')) || fs.existsSync(path.join(dir, 'app'));
    })
    .sort()
    .map((name) => path.join('fixtures', name));
  return [...projectFixtures, 'example'];
}

/** One characterization record for `relRoot` (repo-relative, e.g. "fixtures/soc-clean"):
 * its violations, sorted by module/rule/file/line/message and with `file` left project-relative
 * (already the shape makeViolation produces) so the golden never embeds this checkout's absolute path. */
function characterizeRoot(relRoot) {
  const root = path.join(REPO_ROOT, relRoot);
  const { violations } = aggregateValidation(root, DEFAULT_ENFORCERS);
  const sorted = [...violations].sort((a, b) => (
    a.module.localeCompare(b.module)
    || a.rule.localeCompare(b.rule)
    || a.file.localeCompare(b.file)
    || a.line - b.line
    || a.message.localeCompare(b.message)
  ));
  return { root: relRoot, violations: sorted };
}

/** The full characterization snapshot: one record per `characterizationRoots()` entry. */
export function runCharacterization() {
  return characterizationRoots().map(characterizeRoot);
}
