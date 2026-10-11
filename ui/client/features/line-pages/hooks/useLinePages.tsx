'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSelection } from '@/features/list-browser';
import { featureNames, featureSummary } from '../domain/FeatureList';
import { pageParts } from '../domain/PageParts';
import { featurePages, findPage } from '../domain/PageRows';
import { savePageProp } from '../workflows/SavePropFlow';
import type { LinePagesApi, LinePagesView, LineProject, PagePart, PartProp, PartsState, SaveOutcome } from '../types';

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

  const readParts = useCallback(
    async (f: string) => {
      if (!api) return;
      try {
        const tree = await api.getPageTree(f);
        setParts(Array.isArray(tree?.roots) ? { phase: 'ready', parts: pageParts(tree) } : UNREADABLE);
      } catch {
        setParts(UNREADABLE);
      }
    },
    [api],
  );

  useEffect(() => {
    setOutcome(null);
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

  return { ready: featureSel.ready && pageSel.ready, features, feature, chooseFeature, pages, page, choosePage: selectPage, parts, save, saving, revision, outcome };
}
