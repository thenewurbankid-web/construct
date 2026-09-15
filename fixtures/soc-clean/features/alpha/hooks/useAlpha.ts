import { useCallback } from 'react';

export function useAlpha() {
  return { action: useCallback(() => {}, []) };
}
