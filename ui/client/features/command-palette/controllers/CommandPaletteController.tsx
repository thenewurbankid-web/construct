'use client';

import { useCommandPalette } from '../hooks/useCommandPalette';
import { CommandPalettePage } from '../pages/CommandPalettePage';

/** The palette overlay. Mount once inside CommandRegistryProvider; it also owns the Ctrl/Cmd+K shortcut. */
export function CommandPaletteController() {
  const p = useCommandPalette();
  return (
    <CommandPalettePage
      open={p.open}
      query={p.query}
      onQuery={p.onQuery}
      groups={p.groups}
      activeIndex={p.activeIndex}
      onActiveIndex={p.setActiveIndex}
      onRun={p.run}
      onKeyDown={p.onKeyDown}
      onClose={p.close}
      emptyLabel={p.query ? `No commands match "${p.query}"` : 'No commands available'}
    />
  );
}
