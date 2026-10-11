import { useMemo } from 'react';
import { Detail } from '../pages/Detail-v2';

export function useNextDetail() {
  return useMemo(() => Detail, []);
}
