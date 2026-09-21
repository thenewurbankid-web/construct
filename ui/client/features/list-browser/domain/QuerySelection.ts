// Pure (DOMAIN-001): a selection kept in the URL query (`?feature=billing`), so a reload or a shared link opens the same
// thing. The value is only a NAME; whoever reads it checks it against the real list before using it.

export function readSelection(search: string, param: string): string | null {
  const value = new URLSearchParams(search).get(param);
  return value && value.length <= 512 ? value : null;
}

/** The query string (with its leading `?`, or empty) after setting or clearing `param`; other params are kept. */
export function withSelection(search: string, param: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(param);
  else params.set(param, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The selected id only when it is really in the list, else null: a stale or hand-edited URL selects nothing. */
export function validSelection(ids: string[], wanted: string | null): string | null {
  return wanted !== null && ids.includes(wanted) ? wanted : null;
}
