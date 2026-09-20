'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { flattenVisible, navigate, tabStop } from '../domain/TreeNav';
import { findFileNode, findNode } from '../domain/TreeNodes';
import type { TreeNavProps, TreeNodeView } from '../types';

/**
 * The changed-units tree's keyboard state (#351): which parents are open, which row is the ONE tab stop, and
 * the key handling. What each key means is the pure model in domain/TreeNav.ts; this hook only holds the
 * state and moves DOM focus. Parents start open (the whole change is visible until you fold it).
 */
export function useTreeNavigation(nodes: TreeNodeView[], selectedPath: string | null, onSelect: (path: string) => void): TreeNavProps {
  const [closed, setClosed] = useState<Record<string, true>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);

  const isOpen = useCallback((id: string) => !closed[id], [closed]);
  const rows = useMemo(() => flattenVisible(nodes, isOpen), [nodes, isOpen]);
  const tabStopId = tabStop(rows, activeId, findFileNode(nodes, selectedPath)?.id ?? null);
  const onActivate = useCallback((id: string) => { const n = findNode(nodes, id); if (n?.file) onSelect(n.file.path); }, [nodes, onSelect]);

  const focusRow = useCallback((id: string) => {
    setActiveId(id);
    const el = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).find((n) => n.dataset.nodeId === id);
    el?.focus();
  }, []);

  const setOpen = useCallback((id: string, open: boolean) => {
    setClosed((c) => {
      const next = { ...c };
      if (open) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  const onToggle = useCallback((id: string) => setOpen(id, !isOpen(id)), [setOpen, isOpen]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = (document.activeElement as HTMLElement | null)?.dataset?.nodeId;
    if (!at) return;
    const action = navigate(e.key, rows, at, isOpen);
    if (!action) return;
    e.preventDefault();
    if (action.focus) focusRow(action.focus);
    if (action.open) setOpen(action.open.id, action.open.open);
    if (action.activate) onActivate(action.activate);
  }, [rows, isOpen, focusRow, setOpen, onActivate]);

  return { isOpen, tabStopId, onKeyDown, onToggle, onFocusRow: setActiveId, treeRef };
}
