'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { useLineFixNotice } from '@/features/line-fix';
import { useShellDrawer } from '@/features/shell';
import { featureNames, featureSummary } from '../domain/FeatureList';
import { pageParts, withFragments } from '../domain/PageParts';
import { featurePages, findPage } from '../domain/PageRows';
import { saveCodeFragment } from '../workflows/SaveFragmentFlow';
import { savePageProp } from '../workflows/SavePropFlow';
import type { CodeFragment, FragmentOutcome, LinePagesApi, LinePagesView, LineProject, PagePart, PartProp, PartsState, SaveOutcome } from '../types';

const UNREADABLE: PartsState = { phase: 'error', sentence: 'The parts of this page could not be read, so try again.' };

/** The Line Pages screen's state: the chosen feature and page (kept in the URL as ?feature= and ?page=), the page
 * rows of that feature, the chosen page's parts, and Save. After every save the project and the page's parts are
 * read again (node ids can shift), so what the screen shows is what is on disk, saved or refused. With no Line
 * project (still loading, or not a Line project) it holds nothing. */
export function useLinePages(project: LineProject | null, api: LinePagesApi | null, reloadProject: () => Promise<void>): LinePagesView & { ready: boolean } {
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
    },
    [api],
  );

  useEffect(() => {
    setOutcome(null);
    setFragmentOutcome(null);
    if (!file) {
      setParts({ phase: 'idle' });
      return;
    }
    setParts({ phase: 'loading' });
    void readParts(file);
  }, [file, readParts]);

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
    saveFragment, fragmentOutcome, fixNotice, fixApplied,
  };
}
