// #330 slice A -- what a "clone this repository" request is allowed to name. Pure and deterministic (no fs,
// no network, no git): the URL, the host allowlist, the destination folder name and the "is this address a
// public one" test each have one small answer that is exhaustively unit-tested with hostile input.
//
// The rule is a closed set, not a blocklist: an https URL of exactly `https://<allowed host>/<owner>/<repo>`,
// nothing else. No userinfo (`user:pass@`), no port, no query, no fragment, no `ext::`/`file:`/`ssh:`/`git:`
// or scp-style `host:path`, no option-looking value (a leading `-`), no whitespace or control characters.
import net from 'node:net';
import path from 'node:path';

/** Hosts a clone may name when nothing is configured. gitlab.com / bitbucket.org are opt-in. */
export const DEFAULT_CLONE_HOSTS = Object.freeze(['github.com']);
export const MAX_URL_LENGTH = 300;
export const MAX_SLUG_LENGTH = 100;

export class CloneInputError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CloneInputError';
    this.code = code;
    this.status = status;
  }
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The configured host allowlist: `CONSTRUCT_CLONE_HOSTS=github.com,gitlab.com` (lowercase hostnames only;
 * anything that is not a plain hostname is dropped, so a typo cannot widen the list). */
export function resolveCloneHosts(env = process.env) {
  const raw = env.CONSTRUCT_CLONE_HOSTS;
  if (!raw || !raw.trim()) return [...DEFAULT_CLONE_HOSTS];
  const hosts = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) && /[a-z]$/.test(h.split('.').pop()));
  return hosts.length ? hosts : [...DEFAULT_CLONE_HOSTS];
}

/** A destination folder name (also the repo name): plain ASCII, starts alphanumeric, no `..`, no trailing dot. */
export function validateSlug(slug) {
  if (typeof slug !== 'string' || slug === '') throw new CloneInputError('BAD_NAME', 'A folder name is required.');
  if (slug.length > MAX_SLUG_LENGTH) throw new CloneInputError('BAD_NAME', 'That folder name is too long.');
  if (!SLUG.test(slug) || slug.includes('..') || slug.endsWith('.') || slug.toLowerCase().endsWith('.git')) {
    throw new CloneInputError('BAD_NAME', 'A folder name may use letters, digits, "-", "_" and inner dots only, must start with a letter or digit, and must not end with a dot or ".git".');
  }
  return slug;
}

/** #330: a branch (or tag) name to check out. A closed set, stricter than the version-control tool's own rules:
 * letters, digits and `. _ - /` inside, starting with a letter or digit (so it can never look like an option), no
 * `..`, `//`, no trailing `/` `.` or `.lock`. -> the name, or null when none was given. */
export function validateBranch(branch) {
  if (branch === undefined || branch === null || branch === '') return null;
  if (typeof branch !== 'string' || branch.length > MAX_SLUG_LENGTH) throw new CloneInputError('BAD_BRANCH', 'That branch name is not usable.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || /[./]$/.test(branch) || branch.endsWith('.lock') || /\/\.|\.\//.test(branch)) {
    throw new CloneInputError('BAD_BRANCH', 'A branch name may use letters, digits, "-", "_", "." and "/" only, and must start with a letter or digit.');
  }
  return branch;
}

/**
 * @param {unknown} input what the client sent
 * @param {{hosts?: readonly string[], localRoot?: string|null}} [opts] `localRoot` (test harness only): also accept
 *   a `file://` URL naming an absolute path under that directory.
 * @returns {{kind:'https'|'file', url:string, host:string|null, owner:string|null, repo:string, slug:string, display:string}}
 */
export function parseCloneUrl(input, { hosts = DEFAULT_CLONE_HOSTS, localRoot = null } = {}) {
  if (typeof input !== 'string' || input === '') throw new CloneInputError('BAD_URL', 'A repository URL is required.');
  if (input.length > MAX_URL_LENGTH) throw new CloneInputError('BAD_URL', 'That URL is too long.');
  // Checked on the RAW string: the WHATWG URL parser silently strips tabs/newlines and trims spaces, which
  // would otherwise let a smuggled character through unseen.
  if (!/^[\x21-\x7e]+$/.test(input)) throw new CloneInputError('BAD_URL', 'A repository URL must not contain spaces or control characters.');
  if (input.startsWith('-')) throw new CloneInputError('BAD_URL', 'A repository URL must start with https://.');
  const lower = input.toLowerCase();
  if (localRoot && lower.startsWith('file://')) return parseLocal(input, localRoot);
  if (!lower.startsWith('https://')) throw new CloneInputError('BAD_SCHEME', 'Only https:// repository URLs can be cloned (not ssh, git, file, ext or a bare host).');
  if (input.includes('\\') || input.includes('%')) throw new CloneInputError('BAD_URL', 'That URL contains characters that are not allowed.');
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new CloneInputError('BAD_URL', 'That is not a valid URL.');
  }
  if (u.protocol !== 'https:') throw new CloneInputError('BAD_SCHEME', 'Only https:// repository URLs can be cloned.');
  if (u.username !== '' || u.password !== '' || input.slice(8).split('/')[0].includes('@')) {
    throw new CloneInputError('BAD_URL', 'A repository URL must not contain a user name or password.');
  }
  if (u.port !== '') throw new CloneInputError('BAD_URL', 'A repository URL must not name a port.');
  if (u.search !== '' || u.hash !== '' || input.includes('?') || input.includes('#')) {
    throw new CloneInputError('BAD_URL', 'A repository URL must not carry a query string or fragment.');
  }
  const host = u.hostname.toLowerCase();
  if (!hosts.includes(host)) {
    throw new CloneInputError('HOST_NOT_ALLOWED', `Cloning from ${host || 'that host'} is not allowed. Allowed hosts: ${hosts.join(', ')}.`, 403);
  }
  const parts = u.pathname.split('/').filter((p, i) => !(i === 0 && p === ''));
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop(); // one trailing slash
  if (parts.length !== 2 || u.pathname.includes('//')) {
    throw new CloneInputError('BAD_URL', `Expected https://${host}/<owner>/<repository>.`);
  }
  const [owner, repoRaw] = parts;
  const repo = repoRaw.replace(/\.git$/i, '');
  if (!SEGMENT.test(owner) || owner.includes('..') || owner.endsWith('.')) throw new CloneInputError('BAD_URL', 'The repository owner in that URL is not valid.');
  let slug;
  try {
    slug = validateSlug(repo);
  } catch {
    throw new CloneInputError('BAD_URL', 'The repository name in that URL is not usable as a folder name.');
  }
  return { kind: 'https', url: `https://${host}/${owner}/${repo}.git`, host, owner, repo, slug, display: `${owner}/${repo}` };
}

function parseLocal(input, localRoot) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new CloneInputError('BAD_URL', 'That is not a valid URL.');
  }
  if (u.host !== '' || u.search || u.hash || input.includes('%')) throw new CloneInputError('BAD_URL', 'Only file:///absolute/path is accepted here.');
  const p = path.normalize(u.pathname);
  const root = path.resolve(localRoot);
  if (!path.isAbsolute(p) || !(p.startsWith(root + path.sep))) throw new CloneInputError('HOST_NOT_ALLOWED', 'That local path is outside the test fixtures directory.', 403);
  const repo = path.basename(p).replace(/\.git$/i, '');
  const slug = validateSlug(repo);
  return { kind: 'file', url: `file://${p}`, host: null, owner: null, repo, slug, display: repo };
}

/** Is `addr` (an IP literal) an address on the public internet? Loopback, private, link-local, CGNAT, multicast,
 * unspecified, documentation and reserved ranges are not; an IPv6 address embedding an IPv4 one (mapped,
 * NAT64, 6to4) is judged by the IPv4 it embeds. Anything that is not an IP literal is not public. */
export function isPublicAddress(addr) {
  const v = net.isIP(addr);
  if (v === 4) return isPublicV4(addr.split('.').map(Number));
  if (v === 6) return isPublicV6(addr.toLowerCase());
  return false;
}

function isPublicV4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function expandV6(addr) {
  let s = addr.split('%')[0];
  let tail = null;
  if (s.includes('.')) {
    const i = s.lastIndexOf(':');
    const v4 = s.slice(i + 1).split('.').map(Number);
    tail = [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)];
    s = s.slice(0, i + 1) + tail.join(':');
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const r = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - h.length - r.length).fill('0');
  return [...h, ...fill, ...r].map((x) => parseInt(x || '0', 16));
}

function isPublicV6(addr) {
  const g = expandV6(addr);
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  const embedded = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embedded(g[6], g[7])); // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicV4(embedded(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPublicV4(embedded(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if ((g[0] & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  return true;
}
