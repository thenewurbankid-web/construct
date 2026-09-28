'use client';

import { useCallback, useState } from 'react';
import { GenerateControl, useGenerateMode } from '@/features/generate-control';
import type { GenerateMode, GenerateResult } from '@/features/generate-control';

// GenerateControl's own `result` view has no way back to a clickable Run button (its 'running'-only Cancel
// button is the sole reset, docs/design/ia-five-screens.md 8.6/#382) -- fine for a one-shot action, but this
// panel's actions (refresh, extract-on-every-use) must stay re-runnable after a result. So `result` is never
// passed to GenerateControl here; each outcome is tracked and rendered by this panel instead, right below the
// control, which is always left in 'idle'/'ai-only'/'ai-disclosure' and clickable again.
import { StoryApi, type StorySelector } from '../services/StoryApi';
import { StoryAiApi } from '../services/StoryAiApi';
import { StoryBridgeApi, type StoryDiffResult } from '../services/StoryBridgeApi';
import './story-pattern-panel.css';

type Diff = { kind: 'parse' | 'values'; before: string; after: string; changed: boolean; onApprove: () => Promise<void> };

/** Mode c, "AI proposes the parse pattern once; verified per-use extraction for public pages" (design 9.6,
 * issue #387). The server fetches the page itself through the existing consent-gated `/api/story/fetch`
 * (#384); a skeleton/structure preview is always shown before any model call; the pattern-proposal path spends
 * one model call ONCE and every later refresh is mechanical (0 calls, via `StoryApi.fetch` with the saved
 * `parse`); the per-use extraction path spends one model call every time and mechanically rejects any value
 * that is not quoted, verbatim, in the fetched page text. When the local model is offline, both AI actions
 * refuse (GenerateControl's own "refused-offline" state) and this panel states the same fallback the rest of
 * the Cockpit uses for a stale/unreachable source (design 9.8): "Using snapshot from &lt;time&gt;". */
export function StoryPatternPanel({ feature, url }: { feature: string; url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<'idle' | 'fetching' | 'error'>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [skeleton, setSkeleton] = useState<{ text: string; truncated: boolean; bytes: number } | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);

  const pattern = useGenerateMode('story.pattern-propose');
  const [patternRun, setPatternRun] = useState<{ running: boolean; result: GenerateResult | null }>({ running: false, result: null });
  const extraction = useGenerateMode('story.extract-values');
  const [extractRun, setExtractRun] = useState<{ running: boolean; result: GenerateResult | null }>({ running: false, result: null });
  const [savedParse, setSavedParse] = useState<Record<string, StorySelector> | null>(null);

  const fetchPage = useCallback(async () => {
    setFetchState('fetching');
    setFetchError(null);
    const result = await StoryApi.fetch({ url, consent: 'once' });
    if (result.ok) {
      setHtml(result.text);
      setLastFetchedAt(new Date().toISOString());
      setFetchState('idle');
      const skel = await StoryAiApi.skeleton(result.text);
      if (skel.ok) setSkeleton(skel);
    } else {
      setFetchState('error');
      setFetchError(result.error);
    }
  }, [url]);

  const runPreviewSkeleton = useCallback(async () => {
    if (!html) return;
    const skel = await StoryAiApi.skeleton(html);
    if (skel.ok) setSkeleton(skel);
  }, [html]);

  const runProposePattern = useCallback(
    async (_mode: GenerateMode) => {
      if (!html) return;
      // GenerateControl only renders its own "refused-offline" state when a mechanical option exists
      // (docs/design/ia-five-screens.md 8.6's ai-only view has no fallback to switch to, so it never checks
      // `modelOffline` -- filed as a #382 follow-up). An ai-only action still must not spend a call while
      // offline, so this panel checks first and states the same fallback (design 9.8: "Using snapshot").
      if (pattern.modelOffline) {
        setPatternRun({ running: false, result: { ok: false, summary: lastFetchedAt ? `Using snapshot from ${new Date(lastFetchedAt).toLocaleTimeString()}.` : 'The local model is offline. Using the last snapshot instead of sending anything.' } });
        return;
      }
      setPatternRun({ running: true, result: null });
      const proposal = await StoryAiApi.proposePattern({ feature, url, html });
      if (!proposal.ok) {
        setPatternRun({ running: false, result: { ok: false, summary: proposal.error } });
        return;
      }
      const preview: StoryDiffResult = await StoryBridgeApi.preview({ feature, url, parse: proposal.parse });
      if (!preview.ok) {
        setPatternRun({ running: false, result: { ok: false, summary: preview.error } });
        return;
      }
      setDiff({
        kind: 'parse',
        before: preview.before,
        after: preview.after,
        changed: preview.changed,
        onApprove: async () => {
          const saved = await StoryBridgeApi.save({ feature, url, parse: proposal.parse });
          if (saved.ok) {
            setSavedParse(proposal.parse);
            setDiff(null);
          }
          setPatternRun({
            running: false,
            result: saved.ok
              ? { ok: true, summary: `Pattern saved. ${Object.keys(proposal.parse).length} field(s); later refreshes use 0 model calls.` }
              : { ok: false, summary: saved.error },
          });
        },
      });
      setPatternRun({ running: false, result: { ok: true, summary: `Proposed ${Object.keys(proposal.parse).length} field(s) -- review the diff below.` } });
    },
    [feature, url, html],
  );

  const runRefresh = useCallback(
    async (_mode: GenerateMode) => {
      if (!savedParse) return;
      setPatternRun({ running: true, result: null });
      const result = await StoryApi.fetch({ url, parse: savedParse, consent: 'once' });
      setPatternRun({
        running: false,
        result: result.ok
          ? { ok: true, summary: 'Refreshed mechanically -- 0 model calls.' }
          : { ok: false, summary: result.error },
      });
    },
    [url, savedParse],
  );

  const runExtractValues = useCallback(
    async (_mode: GenerateMode) => {
      if (!html) return;
      setExtractRun({ running: true, result: null });
      const extraction2 = await StoryAiApi.extractValues({ feature, url, html });
      if (!extraction2.ok) {
        const rejectedCount = 'rejected' in extraction2 ? extraction2.rejected.length : 0;
        setExtractRun({ running: false, result: { ok: false, summary: rejectedCount ? `${extraction2.error} (${rejectedCount} rejected)` : extraction2.error } });
        return;
      }
      const preview = await StoryBridgeApi.valuesPreview({ feature, url, values: extraction2.values });
      if (!preview.ok) {
        setExtractRun({ running: false, result: { ok: false, summary: preview.error } });
        return;
      }
      setDiff({
        kind: 'values',
        before: preview.before,
        after: preview.after,
        changed: preview.changed,
        onApprove: async () => {
          const saved = await StoryBridgeApi.valuesSave({ feature, url, values: extraction2.values });
          if (saved.ok) setDiff(null);
          setExtractRun({
            running: false,
            result: saved.ok
              ? { ok: true, summary: `Saved ${Object.keys(extraction2.values).length} verified field(s); ${extraction2.rejected.length} rejected as unverifiable.` }
              : { ok: false, summary: saved.error },
          });
        },
      });
      setExtractRun({
        running: false,
        result: { ok: true, summary: `${Object.keys(extraction2.values).length} verified, ${extraction2.rejected.length} rejected -- review the diff below.` },
      });
    },
    [feature, url, html],
  );

  return (
    <div className="story-pattern-panel" data-testid="story-pattern-panel">
      <div className="spp-fetch">
        <button type="button" onClick={fetchPage} disabled={fetchState === 'fetching'} data-testid="story-fetch-page">
          {html ? 'Re-fetch page' : 'Fetch page'}
        </button>
        {fetchState === 'error' && fetchError && <p className="spp-error" data-testid="story-fetch-error">{fetchError}</p>}
      </div>

      {skeleton && (
        <div className="spp-skeleton" data-testid="story-skeleton-preview">
          <p className="spp-hint">Structure preview -- shown before anything is sent to the model ({skeleton.bytes} bytes{skeleton.truncated ? ', truncated' : ''}):</p>
          <pre data-testid="story-skeleton-text">{skeleton.text}</pre>
          <button type="button" onClick={runPreviewSkeleton} data-testid="story-skeleton-refresh">Refresh preview</button>
        </div>
      )}

      {html && (
        <>
          {pattern.modelOffline && pattern.mode === 'ai' && (
            <p className="spp-offline" data-testid="story-ai-unavailable">
              {lastFetchedAt ? `Using snapshot from ${new Date(lastFetchedAt).toLocaleTimeString()}.` : 'Using snapshot -- no fetch yet.'}
            </p>
          )}
          <GenerateControl
            actionId="story.pattern-propose"
            actionKind="story.pattern-propose"
            label="Propose parse pattern"
            mechanical={savedParse ? { block: 'story.fetch', command: 'construct story refresh' } : null}
            ai={{ allowed: true, model: null }}
            willSend={{ files: 1, bytes: html.length, calls: 1 }}
            target={url}
            modelOffline={pattern.modelOffline}
            mode={pattern.mode}
            running={patternRun.running}
            result={null}
            onRun={savedParse ? runRefresh : runProposePattern}
            onCancel={() => setPatternRun({ running: false, result: null })}
            onChooseMode={pattern.chooseMode}
          />
          {patternRun.result && (
            <p className={`spp-status${patternRun.result.ok ? '' : ' spp-status--fail'}`} data-testid="story-pattern-status">{patternRun.result.summary}</p>
          )}

          {extraction.modelOffline && extraction.mode === 'ai' && (
            <p className="spp-offline" data-testid="story-extract-ai-unavailable">
              {lastFetchedAt ? `Using snapshot from ${new Date(lastFetchedAt).toLocaleTimeString()}.` : 'Using snapshot -- no fetch yet.'}
            </p>
          )}
          <GenerateControl
            actionId="story.extract-values"
            actionKind="story.extract-values"
            label="Extract values (every use)"
            mechanical={null}
            ai={{ allowed: true, model: null }}
            willSend={{ files: 1, bytes: html.length, calls: 1 }}
            target={url}
            modelOffline={extraction.modelOffline}
            mode={extraction.mode}
            running={extractRun.running}
            result={null}
            onRun={runExtractValues}
            onCancel={() => setExtractRun({ running: false, result: null })}
            onChooseMode={extraction.chooseMode}
          />
          {extractRun.result && (
            <p className={`spp-status${extractRun.result.ok ? '' : ' spp-status--fail'}`} data-testid="story-extract-status">{extractRun.result.summary}</p>
          )}
        </>
      )}

      {diff && (
        <div className="spp-diff" data-testid="story-diff-review">
          <p className="spp-hint">{diff.changed ? 'Reviewable diff -- nothing is written until approved:' : 'No change from what is already saved.'}</p>
          {diff.changed && (
            <div className="spp-diff-columns">
              <pre data-testid="story-diff-before">{diff.before}</pre>
              <pre data-testid="story-diff-after">{diff.after}</pre>
            </div>
          )}
          <div className="spp-diff-actions">
            <button type="button" onClick={diff.onApprove} disabled={!diff.changed} data-testid="story-diff-approve">Approve &amp; save</button>
            <button type="button" onClick={() => setDiff(null)} data-testid="story-diff-discard">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
