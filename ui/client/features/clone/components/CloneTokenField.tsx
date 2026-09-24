'use client';

import { Field, Input } from '@/components/ui';

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

type CloneTokenFieldProps = {
  token: string;
  /** A plain problem with the pasted token, or null. */
  tokenProblem: string | null;
  disabled: boolean;
  onToken: (v: string) => void;
};

/** Presentation-only: the one-time access token for a private repository, with the plain-words guide to making a
 * read-only one. The fallback next to "Use my GitHub login" (#638), and the only way when that is off. */
export function CloneTokenField({ token, tokenProblem, disabled, onToken }: CloneTokenFieldProps) {
  return (
    <>
      <Field label="Access token (only for private repos)" hint={tokenProblem ?? 'Used once for this clone and never saved.'}>
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={token}
          disabled={disabled}
          aria-invalid={tokenProblem ? true : undefined}
          onChange={(e) => onToken(e.target.value)}
          data-testid="clone-token"
        />
      </Field>
      <details className="clone__howto" data-testid="clone-token-help">
        <summary>How do I get a token?</summary>
        <ol>
          <li>
            Open <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">GitHub&apos;s new fine-grained token page</a>.
          </li>
          <li>Under &ldquo;Repository access&rdquo; choose &ldquo;Only select repositories&rdquo; and pick just this one.</li>
          <li>Under &ldquo;Repository permissions&rdquo; set &ldquo;Contents&rdquo; to &ldquo;Read-only&rdquo;. Nothing else is needed.</li>
          <li>Give it a short expiry, create it, and paste it above. It can read that one repository and cannot change anything.</li>
        </ol>
      </details>
    </>
  );
}
