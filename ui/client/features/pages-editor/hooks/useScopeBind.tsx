'use client';

import { useState } from 'react';
import { saveNodeProp } from '../services/PropsApi';
import type { PageTree, PagesEditorNode, StatusMessage } from '../types';

/**
 * Click-to-bind (#534, Slice 2): arm exactly one target prop, then commit a chosen scope candidate's
 * name onto it. Reuses the same rewrite `PropRow`/`AutoMapPanel` already use (`saveNodeProp` ->
 * `POST /api/pages/props`, `kind: 'identifier'`) — no new mechanical block, per the design doc's own
 * "reuses pages-editor-propflow-rename/-values" instruction. `index` (an *existing* attribute's
 * position) is looked up from the node's own `props` when the target already has one; omitted (the
 * server appends a new attribute instead) for a declared-but-unpassed prop.
 */
export function useScopeBind(
  feature: string,
  file: string,
  node: PagesEditorNode | null,
  contentHash: string,
  onSaved: (tree: PageTree) => void,
) {
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  /** Pressing a target's Bind control: arms it, or (pressed again on the same target) cancels. */
  function arm(prop: string) {
    setStatus(null);
    setArmed((current) => (current === prop ? null : prop));
  }

  function cancel() {
    setArmed(null);
  }

  async function commit(candidateName: string) {
    if (!armed || !node) return;
    setBusy(true);
    setStatus(null);
    const existing = node.props.find((p) => p.kind !== 'spread' && p.name === armed);
    const result = await saveNodeProp({
      feature,
      file,
      nodeId: node.id,
      propName: armed,
      kind: 'identifier',
      value: candidateName,
      contentHash,
      index: existing?.index,
    });
    setBusy(false);
    if (result.ok) {
      setStatus({ ok: true, message: `Bound "${armed}" to "${candidateName}".` });
      setArmed(null);
      onSaved(result);
    } else {
      setStatus({ ok: false, message: result.error || 'Bind failed.', violations: result.violations });
    }
  }

  return { armed, arm, cancel, commit, busy, status };
}
