import React from "react";

type Tag = { id: string; label: string };

export default function Board({ tags, icons, onIcon }: { tags: Tag[]; icons: string[]; onIcon: (i: string) => void }) {
  return (
    <div className="board">
      <h1>Board</h1>

      <div className="icon-row">
        {icons.map((i) => (
          <button key={i} type="button" onClick={() => onIcon(i)}>
            <span className="icon">{i}</span>
          </button>
        ))}
      </div>

      <div className="tag-list">
        {tags.map((t) => (
          <span key={t.id} className="chip">{t.label}</span>
        ))}
      </div>

      <p className="hint">Drag a card here to tag it.</p>
    </div>
  );
}
