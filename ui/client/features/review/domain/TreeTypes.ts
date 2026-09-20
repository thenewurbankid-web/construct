// Types of the changed-units tree (#351): its nodes, what a key does, and the keyboard state a controller hands the
// component. Re-exported from ../types.ts.
import type { TreeFile } from '../types.ts';

export type TreeGrouping = 'feature' | 'layer' | 'files';

/** One node of the changed-units tree (built in domain/TreeNav.ts; the component only draws it). */
export type TreeNodeView = {
  id: string;
  kind: 'feature' | 'layer' | 'file';
  label: string;
  count: number | null;
  file: TreeFile | null;
  showLayer: boolean;
  testId: string;
  data: Record<string, string>;
  children: TreeNodeView[];
};
/** What a key does in the tree: move focus, open/close a parent, or select a file. */
export type TreeAction = { focus?: string; open?: { id: string; open: boolean }; activate?: string };

/** The tree's keyboard state, owned by hooks/useTreeNavigation (a roving tabindex: ONE row is the tab stop). */
export type TreeNavProps = {
  isOpen: (id: string) => boolean;
  tabStopId: string | null;
  onKeyDown: (e: import('react').KeyboardEvent<HTMLElement>) => void;
  onToggle: (id: string) => void;
  onFocusRow: (id: string) => void;
  treeRef: import('react').RefObject<HTMLUListElement | null>;
};

export type ChangeTreeProps = {
  grouping: TreeGrouping;
  onGrouping: (g: TreeGrouping) => void;
  totals: string;
  ariaLabel: string;
  nodes: TreeNodeView[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  nav: TreeNavProps;
};
