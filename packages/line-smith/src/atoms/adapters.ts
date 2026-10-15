// URL atoms (pure: the same path and base always give the same URL). Network, storage and other effects are not
// in the library (R11, ENGLISH-RULES.md): they belong to app code.

interface UrlLike {
  readonly href: string;
  readonly searchParams: { set(key: string, value: string): void };
}

type UrlConstructor = new (url: string, base?: string) => UrlLike;

function host<T>(name: string): T {
  const found = (globalThis as Record<string, unknown>)[name];
  if (found === undefined) {
    throw new TypeError(`${name} is not available in this runtime; pass one in`);
  }
  return found as T;
}

/**
 * urlFrom(path, base) reads "the URL for path, relative to base". Pure.
 * Exactly `new URL(path, base).href` (TypeError for an invalid URL).
 */
export function urlFrom(path: string, base?: string): string {
  const Url = host<UrlConstructor>('URL');
  return new Url(path, base).href;
}

/**
 * withQuery(url, params) reads "url with the query params set". Pure.
 * A copy of url with each param set (replacing any existing value), via URL.searchParams.set.
 */
export function withQuery(url: string, params: Readonly<Record<string, string | number | boolean>>): string {
  const Url = host<UrlConstructor>('URL');
  const parsed = new Url(url);
  for (const key of Object.keys(params)) {
    parsed.searchParams.set(key, String(params[key]));
  }
  return parsed.href;
}
