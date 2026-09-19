'use client';

import { useCallback, useContext } from 'react';
import { RegistryContext } from './useCommandRegistry';

/** Opens the palette from anywhere (e.g. the top-bar trigger). */
export function useOpenPalette(): () => void {
  const api = useContext(RegistryContext);
  return useCallback(() => api?.setOpen(true), [api]);
}
