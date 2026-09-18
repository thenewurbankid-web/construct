'use client';

import { useState } from 'react';
import { propInputKind, propLabel } from '../domain/PropFormatting';
import { saveNodeProp } from '../services/PropsApi';
import type { PageTree, PropData, StatusMessage } from '../types';

/** One prop's edit/save state (#53). `kind` here is the *widget* kind
 * (string/number/boolean/expression) used to pick the right input control
 * — #77 follow-up: `label`/`isSpread` are derived here (not in the
 * component — COMPONENT-003 bans a component importing domain directly)
 * so a spread prop (`{...rest}`, no attribute name) displays via
 * propLabel instead of a null name. On save, a spread sends its real
 * 'spread' kind (not the collapsed 'expression' widget kind) plus `index`
 * (its position in the attribute list) instead of a name, since
 * buildAttributeSnippet's spread branch renders `{...expr}` rather than
 * `name={expr}` and has no name to look it up by. */
export function usePropRow(feature: string, file: string, nodeId: string, contentHash: string, prop: PropData, onSaved: (tree: PageTree) => void) {
  const kind = propInputKind(prop);
  const isSpread = prop.kind === 'spread';
  const label = isSpread ? propLabel(prop) : prop.name;
  const [value, setValue] = useState<unknown>(prop.value);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    const result = await saveNodeProp({
      feature,
      file,
      nodeId,
      propName: isSpread ? null : prop.name,
      kind: isSpread ? 'spread' : kind,
      value,
      contentHash,
      index: prop.index,
    });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: 'Saved.' });
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Save failed.', violations: result.violations });
    }
  }

  return { kind, label, isSpread, value, setValue, busy, status, save };
}
