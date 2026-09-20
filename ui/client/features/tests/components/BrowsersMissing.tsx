/** Playwright launches Chromium; on a machine that never installed it every run fails at once. Say so up front, with the
 * exact command (#306). Installing from here needs running tests as processes (#305), so it is a command to copy. */
export function BrowsersMissing() {
  return (
    <section className="ts-banner ts-banner--error" role="alert" data-testid="state-browsers" aria-labelledby="state-browsers-h">
      <h3 id="state-browsers-h">Browsers are not installed</h3>
      <p>Playwright needs Chromium once, on this machine, before any test can run.</p>
      <pre className="ts-pre" data-testid="browsers-command">npx playwright install chromium</pre>
      <p className="hint">Run that in a terminal in the project. Installing from here is not available yet.</p>
    </section>
  );
}
