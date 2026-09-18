import { useCallback } from 'react';

export function useDashboard() {
  return { action: useCallback(() => {}, []) };
}
