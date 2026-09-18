import { useCallback } from 'react';

export function useUser() {
  return { action: useCallback(() => {}, []) };
}
