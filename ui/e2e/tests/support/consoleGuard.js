import { expect } from '@playwright/test';

// Every Line spec fails on an unexpected console error or uncaught exception from the page (UAT found a React render
// loop that only showed as a console error). Call once inside a describe:
//
//   failOnConsoleErrors(test, { allow: [/Failed to load resource: .* 400 .*\/api\/line\/plan\/step/] });
//
// `allow` lists the lines a spec provokes on purpose (a refusal it asserts arrives as the browser's network note for
// that 4xx); each pattern is matched against "<message> <url>". Anything else is collected and fails the test after it
// ran, with every line in the message.
/** Lines the browser harness logs by itself, never the page: Playwright's Chromium logs one "Blocked script execution"
 * for ANY sandboxed frame without allow-scripts the moment it attaches, even a static `<p>` (checked 11 Oct 2026 with a
 * bare `<iframe sandbox="" srcdoc="<p>static</p>">`). Cockpit's previews are such frames on purpose (no scripts). */
export const HARNESS_NOISE = [/^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\./];

export function failOnConsoleErrors(test, { allow = [] } = {}) {
  let errors = [];
  const allowed = (line) => [...HARNESS_NOISE, ...allow].some((re) => re.test(line));
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const line = `${m.text()} ${m.location().url ?? ''}`.trim();
      if (!allowed(line)) errors.push(line);
    });
    page.on('pageerror', (e) => {
      const line = `Uncaught: ${String(e?.stack ?? e)}`;
      if (!allowed(line)) errors.push(line);
    });
  });
  test.afterEach(async () => {
    expect(errors, `Unexpected console errors from the page:\n${errors.join('\n')}`).toEqual([]);
  });
}

/** The browser's note for a refused request to `path` (any 4xx): allow it where the spec provokes that refusal. */
export const refusalOf = (path) => new RegExp(`Failed to load resource: the server responded with a status of 4\\d\\d .*${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`);
