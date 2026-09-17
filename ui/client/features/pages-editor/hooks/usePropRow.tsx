'use client';

import { useState } from 'react';
import { propInputKind } from '../domain/PropFormatting';
import { saveNodeProp } from '../services/PropsApi';
import type { PageTree, PropData, StatusMessage } from '../types';

/** One prop's edit/save state (#53). */
export function usePropRow(feature: string, file: string, nodeId: string, contentHash: string, prop: PropData, onSaved: (tree: PageTree) => void) {
  const kind = propInputKind(prop);
  const [value, setValue] = useState<unknown>(prop.value);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    const result = await saveNodeProp({ feature, file, nodeId, propName: prop.name, kind, value, contentHash });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved.' });
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Save failed.', violations: result.violations });
    }
  }

  return { kind, value, setValue, busy, status, save };
}
