// Pure (DOMAIN-001): turn whatever a failed request threw into plain language
// (principles #6/#9: say what happened and the fix, not a stack trace).
import type { ErrorDescription } from '../types.ts';

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|econnrefused|fetch failed/i;

export function describeError(error: unknown, what = 'this'): ErrorDescription {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.trim();
  if (!message || NETWORK.test(message)) {
    return {
      title: `Could not load ${what}`,
      hint: 'The Construct backend did not answer. Check that it is running, then try again.',
    };
  }
  return { title: `Could not load ${what}`, hint: message };
}
