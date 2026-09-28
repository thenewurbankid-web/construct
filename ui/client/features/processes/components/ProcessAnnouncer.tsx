type Props = { message: string };

/** Visually hidden, always mounted: a process changing state is announced no matter which drawer tab
 * or screen you are looking at (#371). */
export function ProcessAnnouncer({ message }: Props) {
  return (
    <div className="sr-only" role="status" aria-live="polite" data-testid="process-live-region">
      {message}
    </div>
  );
}
