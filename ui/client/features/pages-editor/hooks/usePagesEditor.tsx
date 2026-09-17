'use client';

import { useEffect, useReducer } from 'react';
import { propLabel } from '../domain/PropFormatting';
import { findNode } from '../domain/TreeNodes';
import { getFeatures, getPages, getPageTree } from '../services/PagesBrowsing';
import type { PageTree, PagesEditorNode } from '../types';
import { initialPagesEditorState, pagesEditorReducer } from '../workflows/PagesEditor';

function previewTitle(node: PagesEditorNode): string {
  return node.props.map(propLabel).join(' ');
}

/** Top-level browsing/tree/selection state for the pages editor — one
 * feature -> one file -> a parsed JSX tree -> a selected node. */
export function usePagesEditor() {
  const [state, dispatch] = useReducer(pagesEditorReducer, initialPagesEditorState);

  useEffect(() => {
    getFeatures().then((r) => dispatch({ type: 'FEATURES_LOADED', features: r.features || [] }));
  }, []);

  useEffect(() => {
    if (!state.feature) return;
    getPages(state.feature).then((r) => dispatch({ type: 'FILES_LOADED', files: r.files || [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.feature]);

  function setFeature(feature: string) {
    dispatch({ type: 'SET_FEATURE', feature });
  }

  function openFile(file: string) {
    dispatch({ type: 'OPEN_FILE', file });
    getPageTree(state.feature, file).then((r) => {
      if (r.error) dispatch({ type: 'TREE_ERROR', error: r.error });
      else dispatch({ type: 'TREE_LOADED', tree: r });
    });
  }

  function selectNode(nodeId: string) {
    dispatch({ type: 'SELECT_NODE', nodeId });
  }

  function onTreeSaved(tree: PageTree) {
    dispatch({ type: 'TREE_UPDATED', tree });
  }

  const selectedNode = state.tree && state.selectedNodeId ? findNode(state.tree.roots, state.selectedNodeId) : null;

  return { ...state, setFeature, openFile, selectNode, onTreeSaved, selectedNode, previewTitle };
}
