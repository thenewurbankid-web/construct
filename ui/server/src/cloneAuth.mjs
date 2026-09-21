// #330 slice B -- the one-time access token for cloning a PRIVATE repository. Everything about handling that
// secret lives here so it can be read (and attacked) in one place.
//
// The design, and why:
//   * The token arrives only in the authenticated, Origin-checked POST body (cloneApi.mjs), is validated as a
//     closed set (visible ASCII, no whitespace, 1..255) and is held as a Buffer, never a string, so it can be
//     zeroed. It is never put in argv, in the URL, in a job record, in the marker file, in a log or in an error.
//   * git gets it ONLY through GIT_ASKPASS. The helper is a fixed, secret-free shell script created mode 0700 in
//     a fresh 0700 directory that only this server owns, and removed when the job ends. It answers the
//     "Username" prompt with a constant and the "Password" prompt by reading ONE line from file descriptor 3.
//   * Descriptor 3 is a pipe from this server to that one git child. Why a pipe rather than a private
//     environment variable: an environment variable is copied into every process git starts and stays readable
//     for the life of the child in /proc/<pid>/environ (and `ps e`); a pipe carries the bytes once, is consumed
//     by the read, appears in no listing of arguments or environment, and closes when the child exits. The
//     server writes the token, closes its end, and zeroes its Buffer at once; nothing about the token is ever
//     placed in the environment, so there is nothing to scrub from it afterwards.
//   * `credential.helper=` stays cleared (nothing can store the credential) and `http.extraHeader` is never used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloneInputError } from './gitUrl.mjs';

export const MAX_TOKEN_LENGTH = 255;
/** The fixed user name paired with a token. GitHub accepts any non-empty name with a token as the password. */
export const TOKEN_USERNAME = 'x-access-token';

/** Validate the client's token. -> Buffer (the caller owns it and must zero it), or null when none was sent. */
export function parseToken(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') throw new CloneInputError('BAD_TOKEN', 'The access token must be text.');
  // Checked on the raw string, for the same reason as the URL: nothing is normalised before it is judged.
  if (input.length > MAX_TOKEN_LENGTH) throw new CloneInputError('BAD_TOKEN', `The access token is too long (at most ${MAX_TOKEN_LENGTH} characters).`);
  if (!/^[\x21-\x7e]+$/.test(input)) throw new CloneInputError('BAD_TOKEN', 'The access token must be one piece of text with no spaces, line breaks or other special characters.');
  return Buffer.from(input, 'latin1');
}

/** Overwrite a token Buffer. Safe on null. */
export function wipe(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}

// Things that look like a credential even when we did not put them there (a token a remote echoes, a
// user:password@ in a URL git prints): redacted from anything that goes to a client or a log.
const LOOKS_LIKE_SECRET = [
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, '***'],
  [/\bglpat-[A-Za-z0-9_-]{12,}/g, '***'],
  [/\bx-access-token:[^\s@/]+/gi, `${TOKEN_USERNAME}:***`],
  [/\/\/[^/\s@]+@/g, '//***@'], // https://user:pass@host -> https://***@host
  [/\b(authorization:\s*(?:basic|bearer|token)\s+)\S+/gi, '$1***'],
];

/** Build a function that removes a token (when given) and anything token-shaped from a line of text. */
export function makeRedactor(tokenBuf) {
  return (text) => {
    let out = String(text);
    if (Buffer.isBuffer(tokenBuf) && tokenBuf.length > 0 && tokenBuf.some((b) => b !== 0)) {
      const t = tokenBuf.toString('latin1');
      const basic = Buffer.from(`${TOKEN_USERNAME}:${t}`, 'latin1').toString('base64');
      for (const s of [t, encodeURIComponent(t), basic]) if (s) out = out.split(s).join('***');
    }
    for (const [re, to] of LOOKS_LIKE_SECRET) out = out.replace(re, to);
    return out;
  };
}

/** Does git's own wording say "you need to sign in / no such repository as far as you can see"? */
export function looksLikeAuthFailure(text) {
  return /authentication failed|could not read (username|password)|terminal prompts disabled|repository .{0,300}not found|http basic: access denied|invalid credentials|bad credentials|returned error: 40[134]|requested url returned error: 40[134]|permission to .* denied|write access to repository not granted|the requested url returned error/i.test(text);
}

export const AUTH_MESSAGE = 'Private or misspelled — paste a token with read access.';
export const AUTH_MESSAGE_WITH_TOKEN = 'Private or misspelled — the token you pasted was not accepted for this repository. Paste a token with read access to it.';

// No secret in this file. It is written once, verbatim, by createAskpass().
export const ASKPASS_SCRIPT = `#!/bin/sh
# Construct clone helper. Holds no secret: the password is read once from file descriptor 3, a pipe from the server.
case "$1" in
  Username*|username*) printf '%s\\n' '${TOKEN_USERNAME}' ;;
  *) t=; IFS= read -r t <&3 || t=; printf '%s\\n' "$t"; t= ;;
esac
`;

/**
 * Create the per-job askpass helper in a private directory. -> {path, dir, cleanup()}
 * `base` is where the private directory is made (default $CONSTRUCT_ASKPASS_DIR, else the OS temp dir: set it when /tmp is mounted noexec); the directory is 0700 and named with
 * this process's pid so the machine's temp-dir pruning knows whose it is.
 */
export function createAskpass({ base = process.env.CONSTRUCT_ASKPASS_DIR || os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(base, `construct-askpass-${process.pid}-`)); // mkdtemp: mode 0700, unique
  const file = path.join(dir, 'askpass.sh');
  try {
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(file, ASKPASS_SCRIPT, { flag: 'wx', mode: 0o700 });
    fs.chmodSync(file, 0o700);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return {
    path: file,
    dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

/**
 * Hand the token to a spawned git through its descriptor 3, then zero the Buffer it was given (pass a COPY: the
 * caller keeps its own for redacting output until the job ends). The spawn must have been called with stdio `['ignore', 'ignore', 'pipe', 'pipe']`. -> true when written.
 */
export function feedToken(child, tokenBuf) {
  const pipe = child?.stdio?.[3];
  if (!pipe || typeof pipe.end !== 'function') return false;
  pipe.on?.('error', () => { /* the child exited before it asked for the password: nothing to do */ });
  const line = Buffer.concat([tokenBuf, Buffer.from('\n')]);
  pipe.end(line, () => {
    wipe(line);
    wipe(tokenBuf);
  });
  return true;
}

/** Rewrite a `.git/config` text so no remote URL carries credentials; report whether the token is still in it. */
export function scrubGitConfig(text, tokenBuf) {
  const cleaned = text.replace(/^(\s*url\s*=\s*https?:\/\/)[^/\s@]*@/gim, '$1');
  const token = Buffer.isBuffer(tokenBuf) && tokenBuf.length > 0 && tokenBuf.some((b) => b !== 0) ? tokenBuf.toString('latin1') : null;
  return { text: cleaned, changed: cleaned !== text, stillHasToken: token !== null && cleaned.includes(token) };
}
