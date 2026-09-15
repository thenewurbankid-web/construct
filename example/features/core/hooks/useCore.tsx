import { useCallback } from 'react';

export function useCore() {
  return { action: useCallback(() => {}, []) };
}
