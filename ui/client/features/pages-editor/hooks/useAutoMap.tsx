'use client';

import { useState } from 'react';
import { applyAutoMap, getUnmappedProps } from '../services/PagesEditor';
import type { PageTree, StatusMessage } from '../types';

/** Auto-map unmapped child props onto the parent component (#54). */
export function useAutoMap(feature: string, file: string, nodeId: string, contentHash: string, onSaved: (tree: PageTree) => void) {
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function find() {
    setStatus(null);
    const result = await getUnmappedProps(feature, file, nodeId);
    setCandidates(result.candidates || []);
    setChecked(new Set(result.candidates || []));
  }

  function toggle(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setStatus(null);
    const result = await applyAutoMap({ feature, file, nodeId, propNames: [...checked], contentHash });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: `Wired ${checked.size} prop(s).` });
      setCandidates([]);
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Auto-map failed.', violations: result.violations });
    }
  }

  return { candidates, checked, find, toggle, apply, busy, status };
}
