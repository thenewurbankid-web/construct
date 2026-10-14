// IMPURE host adapters: network, storage and URL. No DOM types: each takes a minimal
// structural host object (defaulting to the global one), so it works in Node, browsers
// and tests alike, and the host can be injected.
import type { Result } from './json';

/** The slice of the fetch Response that fetchJson uses. */
export interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The slice of fetch that fetchJson uses. */
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<ResponseLike>;

/** The slice of localStorage/sessionStorage that readStorage/writeStorage use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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
 * fetchJson(url, init, fetcher) reads "the JSON at url". IMPURE (network).
 * `fetch(url, init).then((r) => r.json())` as a Result: { ok: true, value } or
 * { ok: false, error } for a network error, a non-2xx status, or a body that isn't JSON. Never rejects.
 */
export async function fetchJson<T = unknown>(
  url: string,
  init?: Record<string, unknown>,
  fetcher: FetchLike = host<FetchLike>('fetch'),
): Promise<Result<T>> {
  try {
    const response = await fetcher(url, init);
    if (!response.ok) {
      return { ok: false, error: new Error(`HTTP ${response.status}`) };
    }
    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * readStorage(key, storage) reads "the stored value for key". IMPURE (storage).
 * Exactly `storage.getItem(key) ?? undefined` (localStorage by default).
 */
export function readStorage(key: string, storage: StorageLike = host<StorageLike>('localStorage')): string | undefined {
  return storage.getItem(key) ?? undefined;
}

/**
 * writeStorage(key, value, storage) reads "store value under key". IMPURE (storage).
 * Exactly `storage.setItem(key, value)` (localStorage by default).
 */
export function writeStorage(key: string, value: string, storage: StorageLike = host<StorageLike>('localStorage')): void {
  storage.setItem(key, value);
}

/**
 * urlFrom(path, base) reads "the URL for path, relative to base". IMPURE (host URL parser).
 * Exactly `new URL(path, base).href` (TypeError for an invalid URL).
 */
export function urlFrom(path: string, base?: string): string {
  const Url = host<UrlConstructor>('URL');
  return new Url(path, base).href;
}

/**
 * withQuery(url, params) reads "url with the query params set". IMPURE (host URL parser).
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
