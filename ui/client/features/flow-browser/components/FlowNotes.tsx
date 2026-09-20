import type { FlowNote } from '../types';

/** Info-level notes (a blue "i", never a warning): a feature no route reaches, a framework with no route
 * adapter. They explain an empty tree; they are not problems. */
export function FlowNotes({ notes }: { notes: FlowNote[] }) {
  return (
    <>
      {notes.map((n) => (
        <div key={n.code} className="flow-note" role="note" data-testid={`flow-note-${n.code}`}>
          <span className="flow-note-i" aria-hidden="true">i</span>
          <span>{n.message}</span>
        </div>
      ))}
    </>
  );
}
