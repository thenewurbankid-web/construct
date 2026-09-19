'use client';

import { useContext, useEffect } from 'react';
import type { Command } from '../types';
import { RegistryContext } from './useCommandRegistry';

/** Registers `commands` while the calling component is mounted. Memoise the
 * array: a new array identity re-registers (replacing by id, so it is safe but wasteful). */
export function useRegisterCommands(commands: Command[]): void {
  const api = useContext(RegistryContext);
  useEffect(() => {
    if (!api) return;
    api.register(commands);
    const ids = commands.map((c) => c.id);
    return () => api.unregister(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, api?.register, api?.unregister]);
}
