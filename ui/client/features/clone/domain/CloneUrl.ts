// Pure (DOMAIN-001): how an address typed into the clone form is read — the folder name it will get and a plain
// hint when it does not look right. The server re-validates everything; this only saves a round trip.

/** The folder name a URL will get (`https://github.com/o/my-repo(.git)` -> `my-repo`), or '' when it has none yet. */
export function suggestFolderName(url: string): string {
  const m = /^https:\/\/[^/\s]+\/[^/\s]+\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1] : '';
}

/** A short, plain hint about what is wrong with a URL as typed, or null when it looks fine. */
export function urlProblem(url: string): string | null {
  const v = url.trim();
  if (v === '') return null;
  if (!/^https:\/\//i.test(v)) return 'Use an https:// address, for example https://github.com/owner/repository.';
  if (/^https:\/\/[^/]*@/i.test(v)) return 'Do not put a user name or password in the address.';
  if (!/^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s?#]+\/?$/i.test(v)) return 'The address should look like https://github.com/owner/repository.';
  return null;
}
