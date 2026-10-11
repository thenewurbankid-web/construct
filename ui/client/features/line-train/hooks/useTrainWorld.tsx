'use client';

import { useCallback, useEffect, useState } from 'react';
import { ask } from '../services/LineTrainApi';
import type { TrainChoices, TrainHttp, TrainWorld } from '../types';

/** The world a typed request is drafted over (the Line sample by default, or an imaginary project) and its closed
 * choices: features, library items, feature items, problems, the tools, the intents and the domain map. */
export function useTrainWorld(api: TrainHttp, onError: (s: string | null) => void) {
  const [worlds, setWorlds] = useState<TrainWorld[]>([]);
  const [world, setWorld] = useState('sample');
  const [choices, setChoices] = useState<TrainChoices | null>(null);
  const loadChoices = useCallback(async (key: string) => {
    const a = await ask(() => api.choices(key));
    if (a.ok) setChoices(a.value);
    else onError(a.sentence);
  }, [api, onError]);
  useEffect(() => {
    void ask(() => api.worlds()).then((a) => { if (a.ok) setWorlds(a.value.worlds); });
  }, [api]);
  useEffect(() => { void loadChoices(world); }, [loadChoices, world]);
  return { worlds, world, choose: setWorld, choices, reloadChoices: () => loadChoices(world) };
}
