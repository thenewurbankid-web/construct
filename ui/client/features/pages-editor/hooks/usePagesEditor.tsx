'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { propLabel } from '../domain/PropFormatting';
import { findNode } from '../domain/TreeNodes';
import { getFeatures, getPages, getPageTree } from '../services/PagesBrowsing';
import type { PageTree, PagesEditorNode } from '../types';
import { useLivePreview } from './useLivePreview';
import { usePageChange } from './usePageChange';
import { initialPagesEditorState, pagesEditorReducer } from '../workflows/PagesEditor';

function previewTitle(node: PagesEditorNode): string {
  return node.props.map(propLabel).join(' ');
}

/** Top-level browsing/tree/selection state for the pages editor — one
 * feature -> one file -> a parsed JSX tree -> a selected node. */
export function usePagesEditor() {
  const [state, dispatch] = useReducer(pagesEditorReducer, initialPagesEditorState);

  const { feature, file } = state;
  // Handlers are memoised so tabs registered in the shell (which capture them) stay stable.
  const openFile = useCallback(
    (f: string) => {
      dispatch({ type: 'OPEN_FILE', file: f });
      getPageTree(feature, f).then((r) => {
        if (r.error) dispatch({ type: 'TREE_ERROR', error: r.error });
        else dispatch({ type: 'TREE_LOADED', tree: r });
      });
    },
    [feature],
  );
  const reopen = useCallback(() => openFile(file), [openFile, file]);
  const external = usePageChange(feature, file, Boolean(state.tree), reopen);

  useEffect(() => {
    getFeatures().then((r) => dispatch({ type: 'FEATURES_LOADED', features: r.features || [] }));
  }, []);

  useEffect(() => {
    if (!state.feature) return;
    getPages(state.feature).then((r) => dispatch({ type: 'FILES_LOADED', files: r.files || [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.feature]);

  const setFeature = useCallback((f: string) => dispatch({ type: 'SET_FEATURE', feature: f }), []);
  const selectNode = useCallback((nodeId: string) => dispatch({ type: 'SELECT_NODE', nodeId }), []);
  const onTreeSaved = useCallback((tree: PageTree) => dispatch({ type: 'TREE_UPDATED', tree }), []);
  const livePreview = useLivePreview({ roots: state.tree?.roots ?? [], feature: state.feature, file: state.file, onSelectNode: selectNode });
  const selectedNode = state.tree && state.selectedNodeId ? findNode(state.tree.roots, state.selectedNodeId) : null;

  return { ...state, setFeature, openFile, selectNode, onTreeSaved, selectedNode, previewTitle, livePreview, externalChange: external.change, dismissExternalChange: external.dismiss, reloadFromDisk: external.reload };
}
