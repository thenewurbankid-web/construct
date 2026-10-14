// @line-atoms functional 939c25c: generated from smith-functional src/atoms/errors.ts by packages/line-atoms/runtime.mjs --write; do not edit.
// Error atoms: try/catch/finally and throw as expressions.

/**
 * attempt(() => body, (e) => recover, () => cleanup) reads "attempt body, recover from an error, then clean up".
 * Exactly `try { return body } catch (e) { return recover(e) } finally { cleanup }`:
 * cleanup always runs last; without recover the error is rethrown (try/finally).
 */
export function attempt<T>(body: () => T): T;
export function attempt<T, C>(body: () => T, recover: (error: unknown) => C, cleanup?: () => void): T | C;
export function attempt<T>(body: () => T, recover: undefined, cleanup: () => void): T;
export function attempt(
  body: () => unknown,
  recover?: (error: unknown) => unknown,
  cleanup?: () => void,
): unknown {
  try {
    return body();
  } catch (error) {
    if (!recover) {
      throw error;
    }
    return recover(error);
  } finally {
    if (cleanup) {
      cleanup();
    }
  }
}

/**
 * attemptAsync(async () => body, async (e) => recover, async () => cleanup) reads "attempt body asynchronously, recover from an error, then clean up".
 * Exactly an async `try { return await body } catch (e) { return await recover(e) } finally { await cleanup }`.
 */
export async function attemptAsync<T, C = never>(
  body: () => T | PromiseLike<T>,
  recover?: (error: unknown) => C | PromiseLike<C>,
  cleanup?: () => void | PromiseLike<void>,
): Promise<T | C> {
  try {
    return await body();
  } catch (error) {
    if (!recover) {
      throw error;
    }
    return await recover(error);
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }
}

/**
 * fail(error) reads "fail with error".
 * Exactly `throw error`, usable where an expression is needed.
 */
export function fail(error: unknown): never {
  throw error;
}
