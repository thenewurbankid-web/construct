'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLayers, previewMove, previewRename, runChange, type ChangePlan, type LayerInfo, type RefactorPreview } from '../services/ChangeApi';
import { parseUnitPath } from '../domain/UnitPath';
import type { ChangeImpactPreview } from '../domain/ChangeImpact';

export type ChangeVerbId = 'move' | 'rename' | 'extract' | 'wrap';

/** #381's closed verb list — stable ids, never free text (docs/BLOCK-CONTRACT.md, "closed options").
 * Move/Rename run `construct refactor move|rename` (LLM-free, `packages/core/plan.mjs`'s `refactor.move`/
 * `refactor.rename`); Extract and "Wrap in..." have no `PLAN_FLOWS` entry yet, so they are shown disabled
 * rather than silently falling back to a model call. */
export const CHANGE_VERBS: { id: ChangeVerbId; label: string; available: boolean; why?: string }[] = [
  { id: 'move', label: 'Move', available: true },
  { id: 'rename', label: 'Rename', available: true },
  { id: 'extract', label: 'Extract', available: false, why: 'No block yet — AI only.' },
  { id: 'wrap', label: 'Wrap in…', available: false, why: 'No block yet — AI only.' },
];

type Status = 'idle' | 'loading' | 'error';

export function useChange(feature: string, file: string, onImpactPreview?: (v: ChangeImpactPreview | null) => void) {
  const unit = useMemo(() => parseUnitPath(feature, file), [feature, file]);
  const [verb, setVerb] = useState<ChangeVerbId>('move');
  const [toLayer, setToLayer] = useState('');
  const [newName, setNewName] = useState('');
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [preview, setPreview] = useState<RefactorPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<Status>('idle');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [runStatus, setRunStatus] = useState<Status | 'done'>('idle');
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    getLayers().then((r) => setLayers(r.constraints?.layers ?? []));
  }, []);

  // Reset the pending change whenever the open unit changes — a preview on the file you just left is stale.
  useEffect(() => {
    setPreview(null);
    setPreviewStatus('idle');
    setChecked({});
    setRunStatus('idle');
    setRunError(null);
    setNewName(unit?.name ?? '');
    setToLayer('');
  }, [unit?.feature, unit?.layer, unit?.name]);

  const otherLayers = useMemo(() => layers.filter((l) => l.name !== unit?.layer), [layers, unit?.layer]);

  const label = useMemo(() => {
    if (!unit) return '';
    if (verb === 'move') return `Move ${unit.name} to ${toLayer || '…'}`;
    return `Rename ${unit.name} to ${newName || '…'}`;
  }, [unit, verb, toLayer, newName]);

  const files = useMemo(() => preview?.files ?? [], [preview]);

  // The impact preview drawn on the live preview stage mirrors the checklist below exactly — the same
  // dashed boxes, the same "N of M" count, so there is only one source of truth for what will change.
  useEffect(() => {
    if (!onImpactPreview) return;
    if (!preview?.ok || files.length === 0) {
      onImpactPreview(null);
      return;
    }
    onImpactPreview({ verb: verb === 'rename' ? 'rename' : 'move', label, files: files.map((path) => ({ path, checked: checked[path] !== false })) });
    return () => onImpactPreview(null);
  }, [onImpactPreview, preview, files, checked, verb, label]);

  const doPreview = useCallback(async () => {
    if (!unit) return;
    setPreviewStatus('loading');
    setRunStatus('idle');
    setRunError(null);
    const r = verb === 'move' ? await previewMove(unit.feature, unit.name, unit.layer, toLayer) : await previewRename(unit.feature, unit.name, newName, unit.layer);
    setPreview(r);
    setPreviewStatus(r.ok ? 'idle' : 'error');
    if (r.ok) setChecked(Object.fromEntries((r.files ?? []).map((p) => [p, true])));
  }, [unit, verb, toLayer, newName]);

  const toggleFile = useCallback((path: string) => setChecked((c) => ({ ...c, [path]: c[path] === false })), []);

  const discard = useCallback(() => {
    setPreview(null);
    setPreviewStatus('idle');
    setChecked({});
    setRunStatus('idle');
    setRunError(null);
  }, []);

  const checkedCount = files.filter((p) => checked[p] !== false).length;

  const approve = useCallback(async (onStarted: (processId: string) => void) => {
    if (!unit || !preview?.ok) return;
    setRunStatus('loading');
    setRunError(null);
    const selected = files.filter((p) => checked[p] !== false);
    const step: ChangePlan['steps'][number] =
      verb === 'move'
        ? { id: 'change-1', title: label, flow: 'refactor.move', args: { name: unit.name, feature: unit.feature, from: unit.layer, to: toLayer }, executor: 'deterministic', touches: { features: [unit.feature], files: selected.map((path) => ({ path, change: 'modify' })) } }
        : { id: 'change-1', title: label, flow: 'refactor.rename', args: { name: unit.name, newName, feature: unit.feature, layer: unit.layer }, executor: 'deterministic', touches: { features: [unit.feature], files: selected.map((path) => ({ path, change: 'modify' })) } };
    const plan: ChangePlan = { version: 1, ticket: { source: 'text', title: label }, steps: [step] };
    const r = await runChange(plan);
    if (r.ok && r.processId) {
      setRunStatus('done');
      onStarted(r.processId);
    } else {
      setRunStatus('error');
      setRunError(r.error ?? 'The change could not be started.');
    }
  }, [unit, preview, files, checked, verb, toLayer, newName, label]);

  return { unit, verb, setVerb, toLayer, setToLayer, newName, setNewName, otherLayers, label, preview, previewStatus, files, checked, checkedCount, toggleFile, doPreview, discard, runStatus, runError, approve };
}
