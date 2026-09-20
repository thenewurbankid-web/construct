// #302 -- the ONE renderer of a generated spec's executable part, shared by the generator (#348) and the step
// editor (testSteps.mjs), so a step document and its Playwright file can never drift apart: the generator builds
// steps from a scenario, the editor parses steps from a file, and both render through testBlockLines().
//
// Deterministic, no LLM, no imports. EVERY value that reaches source code goes through `lit` (a string literal)
// or `comment` (a `//` comment); nothing here concatenates a caller's text anywhere else.

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** A JS/TS string literal for arbitrary text: JSON-escaped, plus the two line separators JSON leaves raw. */
export const lit = (s) => JSON.stringify(String(s)).split(LS).join('\\u2028').split(PS).join('\\u2029');
/** Text for a `//` comment: control characters and every JS line terminator become spaces. */
export const comment = (s) => String(s).replace(/[\x00-\x1f\x7f\x85]/g, ' ').split(LS).join(' ').split(PS).join(' ');

export const HELPERS = `const harness = (selector: string, why: string) =>
  new Error(
    \`Test harness problem, not a bug in the page: the test harness expected \${selector}. \` +
      \`\${why} Construct binds workflow events to elements by convention (data-testid = the event name in kebab-case; \` +
      \`data-flow / data-flow-state on the element that shows the machine's state). \` +
      \`Add the attribute (or scaffold the page with \\\`construct create page --from\\\`); do not file a product bug for this.\`,
  );

async function required(page: Page, selector: string, why: string) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'attached', timeout: 5_000 });
  } catch {
    throw harness(selector, why);
  }
  return el;
}

async function trigger(page: Page, testId: string, event: string) {
  const el = await required(page, \`[data-testid="\${testId}"]\`, \`It is what the workflow event \${event} binds to.\`);
  await el.click();
}

async function expectFlowState(page: Page, machine: string, state: string, timeout = 5_000) {
  const el = await required(page, \`[data-flow="\${machine}"][data-flow-state]\`, \`It shows the state of the \${machine} workflow.\`);
  await expect(el).toHaveAttribute('data-flow-state', state, { timeout });
}`;

/** `const START_URL ...;` for a start URL (or null: no route reaches the feature). */
export const startUrlLine = (url) => `const START_URL: string | null = ${url === null ? 'null' : lit(url)};`;
export const machineLine = (key) => `const MACHINE = ${lit(key)};`;

/**
 * The lines of ONE step of a test body. Step kinds (the whole vocabulary the editor can read back):
 *   fixme       { text }                     test.fixme(true, "...")   (what the test needs; from the generator)
 *   goto        { url }                      the guard + page.goto(START_URL); `url` lives in START_URL
 *   state       { state, timeout?, note? }   the flow shows this state
 *   event       { event, testId, note? }     a user event: click what `data-testid` binds to
 *   check-text  { text, timeout, note? }     the page shows this text (an assertion: CHECK)
 */
export function stepLines(step) {
  const note = step.note ? [`  // ${comment(step.note)}`] : [];
  switch (step.kind) {
    case 'fixme': return [`  test.fixme(true, ${lit(step.text)});`];
    case 'goto': return ['  if (START_URL === null) return;', '  await page.goto(START_URL);'];
    case 'state': return [...note, `  await expectFlowState(page, MACHINE, ${lit(step.state)}${step.timeout ? `, ${step.timeout}` : ''});`];
    case 'event': return [...note, `  await trigger(page, ${lit(step.testId)}, ${lit(step.event)});`];
    case 'check-text': return [...note, `  await expect(page.getByText(${lit(step.text)})).toBeVisible({ timeout: ${step.timeout} });`];
    default: throw new Error(`Unknown step kind ${lit(step.kind)}`);
  }
}

/** `test("title", async ({ page }) => { ...steps });` as lines. */
export const testBlockLines = (title, steps) => [`test(${lit(title)}, async ({ page }) => {`, ...steps.flatMap(stepLines), '});'];
