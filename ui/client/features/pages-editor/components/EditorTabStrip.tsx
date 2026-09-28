'use client';

export type EditorTab = {
  id: string;
  title: string;
  pinned?: boolean;
  onClose?: () => void;
};

type EditorTabStripProps = {
  tabs: EditorTab[];
  activeId: string;
  onSelect: (id: string) => void;
};

// The stage's editor tab strip (#375): Preview is always first and pinned (no close
// button); a file the user opens for its source joins as an ordinary, closeable tab.
// Local to the stage -- it does not touch the shell's own Tools tablist (Source there
// stays the read-only disclosure it always was).
export function EditorTabStrip({ tabs, activeId, onSelect }: EditorTabStripProps) {
  return (
    <div role="tablist" aria-label="Open in stage" className="pe-tabstrip">
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <span key={tab.id} className={`pe-tab${selected ? ' pe-tab--active' : ''}${tab.pinned ? ' pe-tab--pinned' : ''}`}>
            <button type="button" role="tab" aria-selected={selected} className="pe-tab-select" onClick={() => onSelect(tab.id)}>
              {tab.title}
            </button>
            {tab.onClose && (
              <button type="button" className="pe-tab-close" aria-label={`Close ${tab.title}`} onClick={tab.onClose}>
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
