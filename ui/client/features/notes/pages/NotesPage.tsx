import { EmptyState, ErrorState } from '@/features/states';
import { NoteEditor } from '../components/NoteEditor';
import type { NoteEditorProps } from '../types';

export type NotesPageProps = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  listError: string | null;
  openError: string | null;
  /** null when no note is open. */
  editor: NoteEditorProps | null;
  onCreate: () => void;
};

// Presentation-only: the stage of the Notes screen. Loading, a list that could not be read, no notes yet, a note
// that could not be opened, and the editor are all drawn here; the work is in the hooks.
export function NotesPage({ status, listError, openError, editor, onCreate }: NotesPageProps) {
  return (
    <div className="nt-stage" data-testid="notes-stage">
      <div className="nt-toolbar">
        <h1 className="nt-h1">Notes</h1>
        <p className="nt-lede">Describe a change you want. Drafts are kept on this machine for this project, and no model is called to save or reload one.</p>
      </div>
      {status === 'loading' && <p className="hint" role="status">Reading your notes...</p>}
      {status === 'failed' && <ErrorState title="The notes could not be read" hint={listError ?? undefined} size="inline" />}
      {openError && (
        <p className="nt-error" role="alert" data-testid="notes-open-error">
          {openError}
        </p>
      )}
      {editor && <NoteEditor {...editor} />}
      {status === 'ready' && !editor && !openError && (
        <EmptyState title="No notes yet" size="inline" actions={[{ label: 'Start a note', primary: true, onClick: onCreate }]} />
      )}
    </div>
  );
}
