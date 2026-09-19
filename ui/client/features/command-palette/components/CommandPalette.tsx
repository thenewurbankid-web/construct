import { useEffect, useRef } from 'react';
import type { PaletteViewProps } from '../types';

/** The Ctrl K palette: a modal dialog holding a combobox (search input) and its
 * listbox of commands. Focus stays in the input (options are reached with the
 * arrow keys via aria-activedescendant), so Tab has nowhere else to go and is
 * held inside the dialog; Esc or a click outside closes it. */
export function CommandPalette({ open, query, onQuery, groups, activeIndex, onActiveIndex, onRun, onKeyDown, onClose, emptyLabel }: PaletteViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, query]);

  if (!open) return null;

  let index = -1;
  const total = groups.reduce((n, g) => n + g.commands.length, 0);
  const optionId = (i: number) => `cp-option-${i}`;

  return (
    <div className="cp-backdrop" data-testid="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="palette"
        onKeyDown={(e) => {
          if (e.key === 'Tab') e.preventDefault(); // focus trap: the input is the only tab stop
        }}
      >
        <div className="cp-search">
          <span className="cp-search-icon" aria-hidden="true">
            &gt;
          </span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls="cp-listbox"
            aria-autocomplete="list"
            aria-activedescendant={total ? optionId(activeIndex) : undefined}
            placeholder="Type a command or search..."
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="cp-results" id="cp-listbox" role="listbox" aria-label="Commands">
          {total === 0 && (
            <p className="cp-empty" role="status">
              {emptyLabel}
            </p>
          )}
          {groups.map((g) => (
            <ul key={g.group} className="cp-group" role="group" aria-label={g.group}>
              <li className="cp-group-title" role="presentation" aria-hidden="true">
                {g.group}
              </li>
              {g.commands.map((cmd) => {
                index += 1;
                const i = index;
                const active = i === activeIndex;
                return (
                  <li
                    key={cmd.id}
                    id={optionId(i)}
                    ref={active ? activeRef : undefined}
                    role="option"
                    aria-selected={active}
                    data-testid={`command-${cmd.id}`}
                    className={active ? 'cp-option cp-option--active' : 'cp-option'}
                    onMouseMove={() => !active && onActiveIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onRun(cmd)}
                  >
                    <span className="cp-option-title">{cmd.title}</span>
                    {cmd.hint && <kbd className="cp-option-hint">{cmd.hint}</kbd>}
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
        <div className="cp-foot">
          <span>
            <kbd>Up</kbd> <kbd>Down</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
