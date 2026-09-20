// #351 e2e harness: the real ui/server, with ONE seam swapped so an analysis can be caught mid-flight.
//
// Everything a test observes goes through the product: the real session gate, the real /api/review routes,
// the real process store and engine, the real /ws/processes socket and the real Processes drawer. The only
// change is the review executor's worker: instead of the PR-health engine it forks
// ui/server/src/reviewWorker.slow.fixture.mjs, which really checks out both commits into temporary `git
// worktree`s (exactly what the real worker does to read them) and then holds them, so the test can cancel an
// analysis while its checkouts genuinely exist. The bot runner is refused: an analysis must never reach it.
//
// OG351_MARKER (set by the Playwright config) names the file the worker writes its pid and directories to.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stateDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-e2e-review-state-')));
process.env.CONSTRUCT_STATE_DIR = stateDir;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOW = path.resolve(HERE, '../../server/src/reviewWorker.slow.fixture.mjs');

const { start, processesService, reviewExecutor } = await import('../../server/src/index.mjs');
const { createReviewExecutor, composeExecutors } = await import('../../server/src/reviewAnalyses.mjs');

const slow = createReviewExecutor({ results: reviewExecutor.results, runOptions: { worker: SLOW, graceMs: 500 } });
const botRefused = async () => ({ ok: false, llm: null, error: 'a bot step must not run in this harness' });
processesService.setExecutor(composeExecutors({ bot: botRefused, review: slow.executeStep }));

start();
