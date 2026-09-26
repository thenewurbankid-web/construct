'use client';

import { useEditor } from '@craftjs/core';
import { createElement } from 'react';

/** The settings of the selected block (its `craft.related.settings`), with Delete; a hint when nothing is selected. */
export function SettingsPanel() {
  const { actions, selected } = useEditor((state, query) => {
    const [id] = state.events.selected;
    if (!id) return { selected: null };
    const node = state.nodes[id];
    return { selected: { id, name: node.data.displayName, settings: node.related?.settings, deletable: query.node(id).isDeletable() } };
  });
  if (!selected) {
    return (
      <aside className="pb-settings" aria-label="Settings">
        <h2 className="pb-pane-title">Settings</h2>
        <p className="pb-hint">Select a block on the canvas to edit it.</p>
      </aside>
    );
  }
  const body = selected.settings ? createElement(selected.settings) : null;
  return (
    <aside className="pb-settings" aria-label="Settings" data-testid="pb-settings">
      <h2 className="pb-pane-title">{selected.name}</h2>
      {body}
      <button type="button" className="pb-btn" data-testid="pb-delete" disabled={!selected.deletable} onClick={() => actions.delete(selected.id)}>
        Delete
      </button>
    </aside>
  );
}
