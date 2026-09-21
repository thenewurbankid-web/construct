// Pure (DOMAIN-001): plain-words hints for the optional fields of the clone form. Mirrors of the server's closed
// sets, for a quick hint only; the server is the judge.
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** Is `name` usable as a folder name (the server's rule, mirrored for a quick hint)? */
export function folderNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === '') return null;
  if (n.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n) || n.includes('..') || n.endsWith('.') || n.toLowerCase().endsWith('.git')) {
    return 'A folder name may use letters, digits, "-", "_" and inner dots, and must start with a letter or digit.';
  }
  return null;
}

/** Is `branch` usable as a branch name (mirrors the server's closed set)? */
export function branchProblem(branch: string): string | null {
  const b = branch.trim();
  if (b === '') return null;
  return BRANCH.test(b) && !b.includes('..') && !b.includes('//') && !/[./]$/.test(b) && !b.endsWith('.lock') ? null : 'A branch name may use letters, digits, "-", "_", "." and "/".';
}

/** A token a person can send: one piece of visible text (mirrors the server; the server is the judge). */
export function tokenProblem(token: string): string | null {
  if (token === '') return null;
  if (/\s/.test(token)) return 'A token has no spaces or line breaks. Copy just the token itself.';
  if (token.length > 255 || !/^[\x21-\x7e]+$/.test(token)) return 'That does not look like an access token.';
  return null;
}
