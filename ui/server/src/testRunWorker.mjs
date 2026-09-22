// #305 -- runs ONE test run in a forked child (spawned by testRuns.mjs through reviewRunner.mjs's forkRunner), so the
// Cockpit's request thread never waits on Playwright and a cancel can end the whole run. It reads one job message
// (`{root, feature, name?, area?, baseUrl?}`, all validated by the parent), writes progress lines and one result, and
// exits. On SIGTERM it stops Playwright's process group and removes its temp directory before it exits; if it is
// SIGKILLed instead, the parent reclaims the debris by this worker's pid (src/engine/testRunner.mjs reclaimRunsOf).
import { runFeatureTests, RUN_TIMEOUT_MS } from '../../../packages/engine/testRunner.mjs';

if (process.send) {
  const abort = new AbortController();
  process.once('SIGTERM', () => abort.abort());
  process.once('SIGINT', () => abort.abort());
  process.once('message', async (job) => {
    let result;
    try {
      result = await runFeatureTests(job.root, job.feature, {
        name: job.name,
        area: job.area,
        baseUrl: job.baseUrl,
        signal: abort.signal,
        // the parent's own timeout is a little longer, so a slow run ends here, with its own message
        timeoutMs: RUN_TIMEOUT_MS - 10_000,
        onProgress: (line) => process.send({ progress: String(line).slice(0, 300) }),
      });
    } catch (e) {
      result = { ok: false, error: { code: 'INTERNAL_ERROR', message: String(e?.message || e) } };
    }
    process.send(result, () => process.exit(0));
  });
}
