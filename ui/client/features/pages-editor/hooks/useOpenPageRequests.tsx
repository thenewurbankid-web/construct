'use client';

import { useEffect, type Dispatch } from 'react';
import { getPageTree } from '../services/PagesBrowsing';
import { subscribeOpenPage } from '../services/OpenPageRequest';
import type { PagesEditorAction } from '../workflows/PagesEditor';

/** Opens a page named by the URL (?feature=&file=) or requested from elsewhere
 * (a Diagnostics row): the same steps as picking it by hand. */
export function useOpenPageRequests(dispatch: Dispatch<PagesEditorAction>): void {
  useEffect(
    () =>
      subscribeOpenPage(({ feature, file }) => {
        dispatch({ type: 'SET_FEATURE', feature });
        dispatch({ type: 'OPEN_FILE', file });
        getPageTree(feature, file).then((r) => {
          if (r.error) dispatch({ type: 'TREE_ERROR', error: r.error });
          else dispatch({ type: 'TREE_LOADED', tree: r });
        });
      }),
    [dispatch],
  );
}
