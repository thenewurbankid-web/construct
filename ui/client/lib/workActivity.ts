// "Work is going on": the one signal behind the Cockpit's processing indicator (the top-bar brand mark animates only
// while this is true, and is still otherwise). It counts what the framework is doing on this page's behalf: the
// mechanical commands (create, refactor, research, import, init, validate) and the Import Wizard's session (its model
// work). Running Processes are counted separately by the shell, from the Processes drawer's own data.
//
// It lives in lib/ next to http.ts because the counting happens where every feature's request already passes
// (`postJson`/`getJson`/`sendJson`), so no feature has to remember to report its own work. No network, no timers, no
// I/O of its own: a counter and a subscription (a React `useSyncExternalStore` source).

const WORK_POSTS = /^\/api\/(create|refactor|research|import|init)$/;
const WORK_GETS = /^\/api\/validate(\?.*)?$/;

/** Is this request the framework doing work (as opposed to reading a list, saving a note or moving a pane)? */
export const isWorkRequest = (method: string, path: string): boolean => (method === 'POST' ? WORK_POSTS.test(path) : method === 'GET' && WORK_GETS.test(path));

let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Work started. Returns the function that ends it (safe to call twice). */
export function beginWork(): () => void {
  count += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count -= 1;
    emit();
  };
}

/** How many pieces of work are going on right now. */
export const getWorkCount = (): number => count;

/** Subscribe to changes (for `useSyncExternalStore`). Returns the unsubscribe. */
export function subscribeWork(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Run `call`, counting it as work for as long as it is in flight when it is a work request. */
export async function trackWork<T>(method: string, path: string, call: () => Promise<T>): Promise<T> {
  if (!isWorkRequest(method, path)) return call();
  const end = beginWork();
  try {
    return await call();
  } finally {
    end();
  }
}
