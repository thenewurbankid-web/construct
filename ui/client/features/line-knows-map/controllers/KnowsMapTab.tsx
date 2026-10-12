'use client';

import type { KnowsTabProps } from '@/lib/lineKnowsContract';
import { MapSoon } from '../components/MapSoon';
import { useMapSoon } from '../hooks/useMapSoon';

/** The The Map tab of "What Line knows" (slot: replaced by the tab's own build). */
export function KnowsMapTab(props: KnowsTabProps) {
  const sentence = useMapSoon(props);
  return <MapSoon sentence={sentence} />;
}
