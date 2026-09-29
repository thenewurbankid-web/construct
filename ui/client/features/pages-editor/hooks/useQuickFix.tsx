'use client';

import { useState } from 'react';
import { quickFixPageBuffer } from '../services/PageSourceApi';
import { diffSnippetLines } from '../domain/SnippetDiff';
import type { QuickFixMode } from '../services/PageSourceApi';
import type { DiffHunk, SourceDiagnostic } from '../types';

/** #551 — Mechanical (the rule's own deterministic transform) or AI (a model
 * call scoped to the one violation), previewed as a reviewable diff before
 * it is applied to the editor's draft. Never writes to disk itself — applying
 * a fix only replaces the in-memory buffer the caller already owns. */
export function useQuickFix(feature: string, file: string, draft: string, onApply: (fixed: string) => void) {
  const [rule, setRule] = useState<string | null>(null);
  const [mode, setMode] = useState<QuickFixMode | null>(null);
  const [fixedSource, setFixedSource] = useState<string | null>(null);
  const [hunks, setHunks] = useState<DiffHunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = rule !== null;

  function openMenu(diagnostic: SourceDiagnostic) {
    setRule(diagnostic.code);
    setMode(null);
    setFixedSource(null);
    setHunks([]);
    setError(null);
  }

  function closeMenu() {
    setRule(null);
    setMode(null);
    setFixedSource(null);
    setHunks([]);
    setError(null);
  }

  async function requestFix(nextMode: QuickFixMode) {
    if (!rule) return;
    setMode(nextMode);
    setBusy(true);
    setError(null);
    const r = await quickFixPageBuffer(feature, file, draft, rule, nextMode);
    setBusy(false);
    if (!r.ok || !r.fixedSource) {
      setError(r.error || 'Could not compute a fix.');
      return;
    }
    setFixedSource(r.fixedSource);
    setHunks(diffSnippetLines(draft, r.fixedSource));
  }

  function confirm() {
    if (fixedSource === null) return;
    onApply(fixedSource);
    closeMenu();
  }

  return { active, rule, mode, fixedSource, hunks, busy, error, openMenu, closeMenu, requestFix, confirm };
}
