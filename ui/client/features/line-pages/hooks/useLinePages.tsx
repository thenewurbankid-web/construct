'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { useLineFixNotice } from '@/features/line-fix';
import { useShellDrawer } from '@/features/shell';
import { featureNames, featureSummary } from '../domain/FeatureList';
import { pageParts, withFragments } from '../domain/PageParts';
import { featurePages, findPage } from '../domain/PageRows';
import { saveCodeFragment } from '../workflows/SaveFragmentFlow';
import { savePageProp } from '../workflows/SavePropFlow';
import { saveOutcome } from '../domain/SaveOutcome';
import { bindPartRequest } from '../domain/PageBinding';
import type { BindingFix, BindingState, BindInteractionRequest, CodeFragment, FragmentOutcome, LinePagesApi, LinePagesPlan, LinePagesView, LineProject, PagePart, PartProp, PartsState, SaveOutcome } from '../types';

const UNREADABLE: PartsState = { phase: 'error', sentence: 'The parts of this page could not be read, so try again.' };
const NO_BINDING: BindingState = { phase: 'error', sentence: 'The bindings of this page could not be read, so try again.' };

/** The Line Pages screen's state: the chosen feature and page (kept in the URL as ?feature= and ?page=), the page
 * rows of that feature, the chosen page's parts, and Save. After every save the project and the page's parts are
 * read again (node ids can shift), so what the screen shows is what is on disk, saved or refused. With no Line
 * project (still loading, or not a Line project) it holds nothing. */
export function useLinePages(project: LineProject | null, api: LinePagesApi | null, reloadProject: () => Promise<void>, landed: LinePagesPlan['lastRun'] = null): LinePagesView & { ready: boolean } {
  const featureSel = useUrlSelection('feature');
  const pageSel = useUrlSelection('page');
  const features = useMemo(() => (project ? featureNames(project).map((name) => ({ name, summary: featureSummary(project, name) })) : []), [project]);
  const feature = featureSel.value && features.some((f) => f.name === featureSel.value) ? featureSel.value : null;
  const pages = useMemo(() => (project && feature ? featurePages(project, feature) : []), [project, feature]);
  const found = project ? findPage(project, pageSel.value) : null;
  const page = found && found.feature === feature ? found : null;
  const file = page?.file ?? null;

  const [parts, setParts] = useState<PartsState>({ phase: 'idle' });
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  const [fragmentOutcome, setFragmentOutcome] = useState<FragmentOutcome | null>(null);
  const [binding, setBinding] = useState<BindingState>({ phase: 'idle' });
  const [bindOutcome, setBindOutcome] = useState<SaveOutcome | null>(null);
  const { revalidate } = useShellDrawer();

  const readParts = useCallback(
    async (f: string) => {
      if (!api) return;
      try {
        // The code fragments are extra: when they cannot be read, the parts still show, just without "Edit code".
        const [tree, list] = await Promise.all([api.getPageTree(f), api.getFragments(f).catch(() => null)]);
        const fragments = list && 'fragments' in list && Array.isArray(list.fragments) ? list.fragments : [];
        setParts(tree && 'roots' in tree && Array.isArray(tree.roots) ? { phase: 'ready', parts: withFragments(pageParts(tree), fragments) } : UNREADABLE);
      } catch {
        setParts(UNREADABLE);
      }
      // cu5: both bindings (Morpheus and Trace) of the page; a refusal or a silent server shows one sentence, the parts stay.
      if (!api.getPageBinding) return;
      try {
        const b = await api.getPageBinding(f);
        setBinding(b && 'parts' in b && Array.isArray(b.parts) ? { phase: 'ready', binding: b } : b && 'sentence' in b && typeof b.sentence === 'string' ? { phase: 'error', sentence: b.sentence } : NO_BINDING);
      } catch {
        setBinding(NO_BINDING);
      }
    },
    [api],
  );

  useEffect(() => {
    setOutcome(null);
    setFragmentOutcome(null);
    setBindOutcome(null);
    if (!file) {
      setParts({ phase: 'idle' });
      setBinding({ phase: 'idle' });
      return;
    }
    setParts({ phase: 'loading' });
    setBinding({ phase: 'loading' });
    void readParts(file);
  }, [file, readParts]);

  // cp1: a Save only adds a plan step; once the person approved and it ran, read everything again (node ids, ranges and
  // hashes may have moved) and show what happened.
  const landedId = landed?.stepId ?? null;
  const landedRef = useRef(landed);
  landedRef.current = landed;
  useEffect(() => {
    const run = landedRef.current;
    if (!landedId || !run || !file) return;
    void (async () => {
      await reloadProject();
      await readParts(file);
      if (run.apply) setOutcome(saveOutcome(run.apply));
      setBindOutcome(run.apply ? saveOutcome(run.apply) : null);
      setRevision((r) => r + 1);
    })();
    // Only a newly run step triggers this; the file and readers are read through the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedId]);

  const { select: selectFeature } = featureSel;
  const { select: selectPage } = pageSel;
  const chooseFeature = useCallback(
    (name: string | null) => {
      selectFeature(name);
      selectPage(null);
    },
    [selectFeature, selectPage],
  );

  const save = useCallback(
    async (part: PagePart, prop: PartProp, raw: string | boolean) => {
      if (!file || !api) return;
      setSaving(true);
      const result = await savePageProp(api, file, part, prop, raw);
      await reloadProject();
      await readParts(file);
      setOutcome(result);
      setRevision((r) => r + 1);
      setSaving(false);
    },
    [api, file, readParts, reloadProject],
  );

  const saveFragment = useCallback(
    async (fragment: CodeFragment, code: string) => {
      if (!file || !api) return;
      setSaving(true);
      setFragmentOutcome(null);
      const result = await saveCodeFragment(api, fragment, code);
      if (result.ok) {
        // Landed: read everything again (ranges and hashes moved) and show the sentence at the top.
        await reloadProject();
        await readParts(file);
        setOutcome(result);
        setRevision((r) => r + 1);
      } else {
        // Refused: keep the editor open with what was typed, and the reason next to it.
        setFragmentOutcome({ fragmentId: fragment.id, outcome: result });
      }
      setSaving(false);
    },
    [api, file, readParts, reloadProject],
  );

  // cu5: a bind adds a plan step (mock mode: lands at once); its sentence shows above the bindings, and the page is read
  // again so a landed change (mock) shows straight away. After Approve, the landed-step effect above reads it again.
  const bind = useCallback(
    async (run: () => Promise<unknown> | undefined) => {
      if (!file || !api) return;
      setSaving(true);
      let result: SaveOutcome;
      try {
        result = saveOutcome((await run()) as Parameters<typeof saveOutcome>[0]);
      } catch {
        result = saveOutcome(null);
      }
      await readParts(file);
      setBindOutcome(result);
      setRevision((r) => r + 1);
      setSaving(false);
    },
    [api, file, readParts],
  );
  const current = binding.phase === 'ready' ? binding.binding : null;
  const bindPart = useCallback(
    (partId: string, libraryId: string) => {
      if (current) void bind(() => api?.bindPart?.(bindPartRequest(current, partId, libraryId)));
    },
    [api, bind, current],
  );
  const bindAction = useCallback(
    (fix: BindingFix) => {
      if (current) void bind(() => api?.bindInteraction?.({ ...(fix.step.args as BindInteractionRequest), contentHash: current.contentHash }));
    },
    [api, bind, current],
  );

  // ca2: a fix applied from a page's problem. Its sentence stays at the top; a landed one re-reads the project (the
  // problem leaves its row), the open page's parts, and re-runs validate (Diagnostics, status bar).
  const afterFix = useCallback(async () => {
    await reloadProject();
    if (file) await readParts(file);
    revalidate();
  }, [file, readParts, reloadProject, revalidate]);
  const { notice: fixNotice, onResult: fixApplied } = useLineFixNotice(afterFix);

  return {
    ready: featureSel.ready && pageSel.ready, features, feature, chooseFeature, pages, page, choosePage: selectPage, parts, save, saving, revision, outcome,
    saveFragment, fragmentOutcome, fixNotice, fixApplied, binding, bindPart, bindAction, bindOutcome,
  };
}
