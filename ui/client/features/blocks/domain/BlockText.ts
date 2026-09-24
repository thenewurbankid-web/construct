// Pure (DOMAIN-001): the words the Blocks tab uses, in one place, so a test can hold them to plain language.
import type { BlockArg } from './BlockTypes.ts';

export const KIND_READ = 'Read-only';
export const KIND_WRITE = 'Writes files';
export const MODEL_NONE = 'model calls: 0';
export const MODEL_OPTIONAL = 'can use a model';

/** "Ran 3 times in this project" / "Not run in this project yet". */
export const runsText = (n: number): string => (n <= 0 ? 'Not run in this project yet' : `Ran ${n} ${n === 1 ? 'time' : 'times'} in this project`);

/** What an argument's value looks like, in plain words. */
export function argKind(a: BlockArg): string {
  if (a.enum?.length) return `one of ${a.enum.join(', ')}`;
  if (a.path) return 'a path inside the project';
  switch (a.type) {
    case 'string[]': return 'a list, separated by commas';
    case 'boolean': return 'yes or no';
    case 'object': return 'structured data';
    default: return 'text';
  }
}

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** An argv as one line a person could paste into a terminal: a word with anything unusual in it is single-quoted. */
export function commandText(argv: string[] | null): string | null {
  if (!argv) return null;
  return argv.map((w) => (SAFE.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ');
}

/** The one line under a card that is turned off. */
export const OFF_HINT = 'Turned off for this project: a plan that uses it is refused.';

/** The Plan screen's button label on a card. */
export const RUN_LABEL = 'Run this block';
