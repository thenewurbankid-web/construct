'use client';

import { useState, type FormEvent } from 'react';
import { LAYERS, toggleLayer } from '../domain/Dashboard';
import { createCommand, importCommand, refactorCommand, researchCommand } from '../services/Dashboard';
import { createFormVisibility, importFormVisibility, refactorFormVisibility } from '../workflows/Dashboard';
import type { CommandResult } from '../types';

function useCreateForm() {
  const [kind, setKind] = useState('feature');
  const [name, setName] = useState('');
  const [feature, setFeature] = useState('');
  const [layer, setLayer] = useState<string>(LAYERS[0]);
  const [layers, setLayers] = useState<string[]>([]);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await createCommand({ kind: kind as never, name, feature, layer, layers }));
    setBusy(false);
  }

  return {
    kind, setKind, name, setName, feature, setFeature, layer, setLayer, layers,
    toggleLayer: (l: string) => setLayers((prev) => toggleLayer(prev, l)),
    result, busy, run, visibility: createFormVisibility(kind),
  };
}

function useRefactorForm() {
  const [action, setAction] = useState('move');
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [feature, setFeature] = useState('');
  const [from, setFrom] = useState<string>(LAYERS[0]);
  const [to, setTo] = useState<string>(LAYERS[1]);
  const [layer, setLayer] = useState<string>(LAYERS[0]);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await refactorCommand({ action: action as never, name, newName, feature, from, to, layer }));
    setBusy(false);
  }

  return {
    action, setAction, name, setName, newName, setNewName, feature, setFeature, from, setFrom, to, setTo,
    layer, setLayer, result, busy, run, visibility: refactorFormVisibility(action),
  };
}

function useResearchForm() {
  const [action, setAction] = useState('doctor');
  const [feature, setFeature] = useState('');
  const [format, setFormat] = useState('json');
  const [since, setSince] = useState('');
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await researchCommand({ action: action as never, feature: feature || undefined, format, since: since || undefined }));
    setBusy(false);
  }

  return { action, setAction, feature, setFeature, format, setFormat, since, setSince, result, busy, run };
}

function useImportForm() {
  const [mode, setMode] = useState('unit');
  const [name, setName] = useState('');
  const [feature, setFeature] = useState('');
  const [layers, setLayers] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [planPath, setPlanPath] = useState('');
  const [useLlm, setUseLlm] = useState(false);
  const [llm, setLlm] = useState('claude');
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await importCommand({ mode: mode as never, name, feature, layers, from, planPath, llm: useLlm ? llm : undefined }));
    setBusy(false);
  }

  return {
    mode, setMode, name, setName, feature, setFeature, layers,
    toggleLayer: (l: string) => setLayers((prev) => toggleLayer(prev, l)),
    from, setFrom, planPath, setPlanPath, useLlm, setUseLlm, llm, setLlm, result, busy, run,
  };
}

/** Composes the Dashboard's four independent command forms — one hook per
 * form (kept in this same file rather than four separate files since each
 * is a small, private implementation detail of the Dashboard feature, not
 * something any other feature or route needs on its own). */
export function useDashboard() {
  return {
    create: useCreateForm(),
    refactor: useRefactorForm(),
    research: useResearchForm(),
    importForm: useImportForm(),
  };
}
