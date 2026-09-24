'use client';

/** Presentation-only: a plain-words problem as an alert, or nothing when there is none. */
export function StatusLine({ message, testId }: { message: string | null; testId: string }) {
  if (!message) return null;
  return (
    <p className="status-error" role="alert" data-testid={testId}>
      {message}
    </p>
  );
}
