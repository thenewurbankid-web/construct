import { useCallback } from 'react';

export function useSettings() {
  return { action: useCallback(() => {}, []) };
}
