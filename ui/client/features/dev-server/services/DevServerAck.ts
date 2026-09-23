// "Starting a dev server runs your project's code, so you see the exact command once." Remembered per project
// AND per command text: when package.json's script changes, the question comes back. Browser-local, best effort:
// if storage is unavailable the question is simply asked every time, which is the safe direction.
const KEY = 'construct.devServer.seen';

type Seen = Record<string, string>;

function read(): Seen {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Seen) : {};
  } catch {
    return {};
  }
}

/** Has this project's current command already been shown and accepted? */
export function hasSeenCommand(root: string | null, commandText: string | null): boolean {
  if (!root || !commandText) return false;
  return read()[root] === commandText;
}

/** Remember that this project's command was shown and accepted. */
export function rememberCommand(root: string | null, commandText: string | null): void {
  if (!root || !commandText) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...read(), [root]: commandText }));
  } catch {
    /* unavailable: ask again next time */
  }
}
