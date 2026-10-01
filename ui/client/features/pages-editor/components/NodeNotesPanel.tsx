'use client';

import { useState } from 'react';
import type { NodeNotes } from '../hooks/useNodeNotes';

type NodeNotesPanelProps = { notes: NodeNotes | null; onCreate: (title: string) => void };

// #832 -- design 8.2's "Notes" inspector section: notes anchored to the selected node, same collapsed
// `.pal-group` disclosure Impact/Tests/Findings/Rule-violations already use. Opening a note hands off to the
// standalone Notes screen (`/notes?note=<id>`, #373's own address scheme) rather than a second note editor.
// The pin on the live preview (acceptance bullet 3) is NOT included: it is meant to land alongside #831's pin
// (same idiom, not a second pin style), which is itself split to #835 pending new previewBridge rect machinery.
export function NodeNotesPanel({ notes, onCreate }: NodeNotesPanelProps) {
  const [draftTitle, setDraftTitle] = useState('');
  const summaryText = notes === null ? 'checking…' : !notes.ok ? 'unknown' : notes.notes.length === 0 ? '0 notes' : `${notes.notes.length} note${notes.notes.length === 1 ? '' : 's'}`;
  return (
    <details className="node-notes-panel pal-group" data-testid="node-notes-panel">
      <summary>
        Notes <span className="pal-count" data-testid="node-notes-count">{summaryText}</span>
      </summary>
      {notes?.ok && (notes.notes.length === 0 ? (
        <p className="hint">No notes anchored to this element.</p>
      ) : (
        <ul className="node-notes-list" data-testid="node-notes-list">
          {notes.notes.map((n) => (
            <li key={n.id}>
              <a href={`/notes?note=${encodeURIComponent(n.id)}`}>{n.title || 'Untitled'}</a>
            </li>
          ))}
        </ul>
      ))}
      {notes?.ok && (
        <form
          className="node-notes-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftTitle.trim()) return;
            onCreate(draftTitle.trim());
            setDraftTitle('');
          }}
        >
          <input
            type="text"
            placeholder="New note on this element…"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            data-testid="node-notes-new-title"
          />
          <button type="submit" disabled={!draftTitle.trim()} data-testid="node-notes-new-submit">Add note</button>
        </form>
      )}
    </details>
  );
}
