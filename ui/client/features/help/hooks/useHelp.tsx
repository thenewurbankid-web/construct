'use client';

import { useEffect, useState } from 'react';
import { fetchHelp } from '../services/Help';
import type { HelpViewState } from '../types';
import { loadedHelpView } from '../workflows/Help';

export function useHelp(): HelpViewState {
  const [view, setView] = useState<HelpViewState>({ status: 'loading' });

  useEffect(() => {
    fetchHelp()
      .then((help) => setView(loadedHelpView(help)))
      .catch((e) => setView({ status: 'error', message: e?.message || 'Failed to load CLI help from the backend.' }));
  }, []);

  return view;
}
