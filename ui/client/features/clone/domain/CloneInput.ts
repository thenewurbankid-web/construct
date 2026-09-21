// Pure (DOMAIN-001): read whatever a person pastes into the one "repository" field. Convenience only: it turns the
// forms people really copy (owner/repo, a browser-bar address with /tree/<branch> or ?tab=, a .git address, an ssh
// address, a whole `git clone ...` line) into the one https address the server accepts, and remembers a branch.
// The server re-validates everything and stays the authority; nothing here runs a shell or reaches the network.

export type CloneInputSource = 'shorthand' | 'address' | 'browser' | 'ssh' | 'command';

export type CloneInput =
  | { ok: true; url: string; host: string; owner: string; repo: string; slug: string; branch: string | null; source: CloneInputSource; note: string | null }
  | { ok: false; problem: string };

const DEFAULT_HOST = 'github.com';
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** Path words in a browser-bar address that put a branch (or commit) right after them. */
const BRANCH_WORDS = new Set(['tree', 'blob', 'blame', 'commits', 'raw', 'edit']);
/** `git clone` flags that take a value as the next word (so the value is not mistaken for the address). */
const VALUE_FLAGS = new Set(['-b', '--branch', '-o', '--origin', '-c', '--config', '--depth', '--reference', '--reference-if-able', '--template', '-j', '--jobs', '--separate-git-dir', '-u', '--upload-pack', '--filter', '--server-option', '--shallow-since', '--shallow-exclude', '--bundle-uri']);

const bad = (problem: string): CloneInput => ({ ok: false, problem });

const stripQuotes = (s: string) => s.replace(/^(["'])(.*)\1$/, '$2');

/** The words of a pasted `git clone` line, read as plain text (no shell): the address, and a `-b`/`--branch` value. */
function fromCommand(text: string): { target: string; branch: string | null } | string {
  const words = text.trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== 'git' || words[1]?.toLowerCase() !== 'clone') return 'That does not look like a git clone command.';
  let branch: string | null = null;
  let target: string | null = null;
  for (let i = 2; i < words.length; i += 1) {
    const w = words[i];
    if (/`|\$\(/.test(w)) return 'Paste just the git clone command (one command, nothing after it).';
    const cut = w.search(/[;&|<>]/);
    if (cut >= 0) {
      // a shell operator ends the command; a URL glued to it (`url;`) still counts, everything after is ignored
      if (cut > 0 && !w.startsWith('-') && target === null) target = stripQuotes(w.slice(0, cut));
      break;
    }
    if (w.startsWith('-')) {
      const [flag, inline] = w.split('=', 2);
      if ((flag === '-b' || flag === '--branch') && (inline !== undefined || i + 1 < words.length)) branch = stripQuotes(inline !== undefined ? inline : words[i + 1]);
      if (inline === undefined && VALUE_FLAGS.has(flag)) i += 1;
      continue;
    }
    target = stripQuotes(w);
    break; // the first word that is not a flag is the address; a folder name after it is ignored
  }
  return target ? { target, branch } : 'That git clone command has no repository address in it.';
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Read one pasted string. Never throws. */
export function normalizeCloneInput(raw: string): CloneInput {
  let text = (raw ?? '').trim();
  if (text === '') return bad('Paste a repository address.');
  if (/[\x00-\x1f\x7f]/.test(text.replace(/[\t\r\n]/g, ' '))) return bad('That contains characters that cannot be part of an address.');
  let source: CloneInputSource = 'address';
  let rememberedBranch: string | null = null;

  if (/^git\s/i.test(text) && !/^git\s+clone(\s|$)/i.test(text)) return bad('That does not look like a git clone command.');
  if (/^git\s+clone(\s|$)/i.test(text)) {
    const c = fromCommand(text);
    if (typeof c === 'string') return bad(c);
    text = c.target;
    rememberedBranch = c.branch;
    source = 'command';
  } else if (/\s/.test(text)) {
    return bad('The address must not contain spaces.');
  }

  if (/(^|[/@:])(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,})/.test(text)) return bad('That looks like an access token, not a repository. Paste the token into the access token field instead.');
  if (/(^|[/@:])\.\.(\/|$|[?#])/.test(text) || /%2e|\\/i.test(text)) return bad('The address contains a path that is not valid.');
  let host = DEFAULT_HOST;
  let pathText: string;
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(text); // git@github.com:owner/repo.git
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    host = scp[2].toLowerCase();
    pathText = scp[3];
    source = source === 'command' ? 'command' : 'ssh';
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)![1].toLowerCase();
    if (scheme === 'file') {
      // Not an address the product accepts: the server refuses it unless it runs in its test setup. Passed through
      // (never rewritten) so the server gives the verdict, in its own words.
      const base = (text.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '').replace(/\.git$/i, '');
      if (!SEGMENT.test(base)) return bad('That local path is not a repository address.');
      return { ok: true, url: text, host: '', owner: '', repo: base, slug: base, branch: rememberedBranch, source, note: 'A local path: only a server set up for testing accepts it.' };
    }
    if (scheme === 'http') return bad('Use an https:// address (http is not secure enough).');
    if (scheme !== 'https' && scheme !== 'ssh' && scheme !== 'git') return bad(`Only https addresses can be cloned (not ${scheme}://).`);
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      return bad('That is not a valid address.');
    }
    if (u.password !== '' || (scheme === 'https' && u.username !== '')) return bad('Take the user name or password out of the address. For a private repository use the access token field instead.');
    if (u.port !== '' && scheme === 'https') return bad('The address must not name a port.');
    host = u.hostname.toLowerCase();
    pathText = u.pathname; // the query and #fragment are dropped: they are only how the browser page was opened
    if (scheme === 'ssh' || scheme === 'git') source = source === 'command' ? 'command' : 'ssh';
    else if (source !== 'command') source = /\/(tree|blob|pull|issues|commit|commits|blame|actions|releases|wiki|compare|tags|branches|settings)\b/.test(pathText) || /[?#]/.test(text) ? 'browser' : 'address';
  } else {
    // no scheme: `github.com/owner/repo` or the shorthand `owner/repo`
    const noQuery = text.split(/[?#]/)[0];
    const first = noQuery.split('/')[0];
    if (first.includes('.') && HOST.test(first.toLowerCase())) {
      host = first.toLowerCase();
      pathText = noQuery.slice(first.length);
      source = source === 'command' ? 'command' : /\/(tree|blob|pull|issues|commit|commits)\b/.test(pathText) || /[?#]/.test(text) ? 'browser' : 'address';
    } else {
      pathText = `/${noQuery}`;
      source = source === 'command' ? 'command' : 'shorthand';
    }
  }

  if (!HOST.test(host)) return bad('That does not look like a repository address.');
  const parts = pathText.split('/').filter((p) => p !== '');
  if (parts.length < 2) return bad(`The address should look like https://${host}/owner/repository, or just owner/repository.`);
  const owner = decode(parts[0]);
  const repo = decode(parts[1]).replace(/\.git$/i, '');
  if (!SEGMENT.test(owner) || owner.includes('..') || owner.endsWith('.')) return bad('The owner part of the address is not valid.');
  if (!SEGMENT.test(repo) || repo.includes('..') || repo.endsWith('.')) return bad('The repository name in the address is not valid.');
  if (source === 'shorthand' && parts.length !== 2) return bad('Use owner/repository, with nothing after it.');
  if ((source === 'ssh') && parts.length !== 2) return bad('The address should end after owner/repository.');

  // A branch from a browser-bar address: the first word after /tree/, /blob/ ... Only the first path word: a branch
  // called feature/x cannot be told from a folder inside branch feature, so the branch field can be edited.
  let branch = rememberedBranch;
  if (branch === null && BRANCH_WORDS.has(parts[2] ?? '') && parts[3]) branch = decode(parts[3]);
  let note: string | null = null;
  if (branch !== null && (!BRANCH.test(branch) || branch.includes('..') || branch.includes('//') || /[./]$/.test(branch))) {
    branch = null;
    note = 'The branch in that address was not usable, so the default branch will be used.';
  }
  return { ok: true, url: `https://${host}/${owner}/${repo}.git`, host, owner, repo, slug: repo, branch, source, note };
}

/** Plain words for how the pasted text was read, shown under the field. */
export function describeSource(s: CloneInputSource): string {
  switch (s) {
    case 'shorthand': return 'Read as owner/repository on github.com.';
    case 'browser': return 'Read from a web page address; only the repository part is used.';
    case 'ssh': return 'Read an ssh address and converted it to https.';
    case 'command': return 'Read from a git clone command; only the address is used.';
    default: return 'Address understood.';
  }
}
