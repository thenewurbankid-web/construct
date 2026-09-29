'use client';

// #748 (R6) -- everything the spec-breakdown screen does: load an accepted spec's report + read-back, offer
// "Generate" (mechanical, the whole spec) and, per function row, "Fill with AI" (create.unit with an LLM,
// #514/#541). Plain useState (as the Dashboard's own command forms do): this screen has no multi-step flow to
// model, just a handful of independent async actions against one open `file`.
import { useCallback, useState } from 'react';
import { fillFunctionWithAi, generateSpec, loadReadBack, loadSpecReport, viewFunctionCode } from '../services/SpecBreakdownApi';
import type { GenerateResult, MachineSpecReport, ReadBack } from '../types';

type FillState = { name: string; busy: boolean; ok: boolean | null; message: string | null };
type CodeView = { name: string; source: string } | { name: string; error: string };

export function useSpecBreakdown(file: string) {
  const [report, setReport] = useState<MachineSpecReport | null>(null);
  const [readBack, setReadBack] = useState<ReadBack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [fill, setFill] = useState<FillState | null>(null);
  const [codeView, setCodeView] = useState<CodeView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await loadSpecReport(file);
    if (!r.ok) {
      setError(r.error);
      setLoading(false);
      return;
    }
    setReport(r.report);
    if (r.report.status === 'passed') {
      const rb = await loadReadBack(file);
      if (rb.ok) setReadBack(rb.readBack);
      else setError(rb.error);
    } else {
      setReadBack(null);
    }
    setLoading(false);
  }, [file]);

  const generate = useCallback(
    async (feature?: string) => {
      setGenerating(true);
      const r = await generateSpec(file, feature);
      setGenerating(false);
      if (r.ok) setGenerateResult(r.result);
      else setError(r.error);
    },
    [file],
  );

  const fillWithAi = useCallback(async (name: string, feature: string) => {
    setFill({ name, busy: true, ok: null, message: null });
    const r = await fillFunctionWithAi(name, feature);
    setFill({ name, busy: false, ok: r.ok, message: r.ok ? (r.output?.join('\n') ?? 'Written.') : (r.error ?? 'The fill was refused.') });
  }, []);

  const viewCode = useCallback(async (feature: string, name: string) => {
    const r = await viewFunctionCode(feature, name);
    setCodeView(r.ok ? { name, source: r.source } : { name, error: r.error });
  }, []);

  return { report, readBack, error, loading, load, generate, generating, generateResult, fillWithAi, fill, viewCode, codeView, closeCodeView: () => setCodeView(null) };
}
