'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useRegisterShellTab } from '@/features/shell';
import '../components/notes.css';
import { buildEditorView, buildRows } from '../domain/NotesView';
import { useNotes } from '../hooks/useNotes';
import { NotesPage } from '../pages/NotesPage';
import { notesShellTabs } from '../pages/NotesShellTabs';

function NotesScreen() {
  const n = useNotes();
  const { state } = n;
  const view = buildEditorView(state);
  const tabs = notesShellTabs({ rows: buildRows(state), status: state.list.status, error: state.list.error, onOpen: n.open, onCreate: n.create });
  useRegisterShellTab('browser', tabs.browser);
  const editor = view && {
    view,
    onTitle: (title: string) => n.edit({ title }),
    onBody: (body: string) => n.edit({ body }),
    onBlur: () => void n.flush(),
    onRetry: () => void n.retry(),
    onKeepMine: n.keepMine,
    onLoadTheirs: n.loadTheirs,
    onToggleCompare: n.toggleCompare,
    onDuplicate: () => void n.duplicate(),
    onConfirmDelete: n.confirmDelete,
    onDelete: () => void n.remove(),
  };
  return <NotesPage status={state.list.status} listError={state.list.error} openError={state.openError} editor={editor} onCreate={() => void n.create()} />;
}

/** The Notes screen (`/notes`): durable drafts for the open project, autosaved. The list is the Browser's tab, the open
 * note is the stage. Nothing here calls a model. */
export function NotesController() {
  return (
    <ProjectGateController>
      <NotesScreen />
    </ProjectGateController>
  );
}
