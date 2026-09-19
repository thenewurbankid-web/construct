'use client';

import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { addCommands, removeCommands } from '../domain/CommandRegistry';
import type { Command } from '../types';

export type RegistryApi = {
  commands: Command[];
  open: boolean;
  setOpen: (open: boolean) => void;
  register: (commands: Command[]) => void;
  unregister: (ids: string[]) => void;
};

const NONE: Command[] = [];
export const RegistryContext = createContext<RegistryApi | null>(null);

/** Holds the registered commands and whether the palette is open. Mount once
 * (the shell does); features then call useRegisterCommands. */
export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [commands, setCommands] = useState<Command[]>(NONE);
  const [open, setOpen] = useState(false);
  const register = useCallback((added: Command[]) => setCommands((c) => addCommands(c, added)), []);
  const unregister = useCallback((ids: string[]) => setCommands((c) => removeCommands(c, ids)), []);
  const value = useMemo(() => ({ commands, open, setOpen, register, unregister }), [commands, open, register, unregister]);
  return createElement(RegistryContext.Provider, { value }, children);
}

/** Registered commands and the open state (empty/no-op outside the provider). */
export function useCommandRegistry() {
  const api = useContext(RegistryContext);
  return { commands: api?.commands ?? NONE, open: api?.open ?? false, setOpen: api?.setOpen ?? (() => {}) };
}
