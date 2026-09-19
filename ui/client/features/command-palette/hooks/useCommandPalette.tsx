'use client';

import { useCallback, useMemo, useReducer } from 'react';
import { flatten, groupCommands } from '../domain/CommandGroups';
import { filterCommands } from '../domain/CommandSearch';
import { initialPalette, paletteReducer } from '../workflows/PaletteState';
import type { Command } from '../types';
import { useCommandRegistry } from './useCommandRegistry';
import { usePaletteLifecycle } from './usePaletteLifecycle';

/** Palette behaviour: the query filters the registered commands, arrows move,
 * Enter runs, Esc closes. */
export function useCommandPalette() {
  const { commands, open, setOpen } = useCommandRegistry();
  const [state, dispatch] = useReducer(paletteReducer, initialPalette);
  usePaletteLifecycle(open, setOpen, dispatch);

  const groups = useMemo(() => groupCommands(filterCommands(commands, state.query)), [commands, state.query]);
  const flat = useMemo(() => flatten(groups), [groups]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const run = useCallback(
    (cmd: Command) => {
      setOpen(false);
      setTimeout(() => cmd.run(), 0); // after the dialog closes, so focus restore cannot fight the command
    },
    [setOpen],
  );
  const onKeyDown = useCallback(
    (e: { key: string; preventDefault: () => void }) => {
      if (!['Escape', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') flat[state.activeIndex] && run(flat[state.activeIndex]);
      else dispatch({ type: 'MOVE', key: e.key, count: flat.length });
    },
    [close, run, flat, state.activeIndex],
  );

  const onQuery = useCallback((query: string) => dispatch({ type: 'QUERY', query }), []);
  const setActiveIndex = useCallback((index: number) => dispatch({ type: 'SET_ACTIVE', index }), []);
  return { open, close, run, onKeyDown, onQuery, setActiveIndex, groups, query: state.query, activeIndex: state.activeIndex };
}
