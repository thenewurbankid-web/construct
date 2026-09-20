'use client';

import { useRegisterShellTab } from '@/features/shell';
import { GLOSSARY } from '../domain/BadgeGlossary';
import { badgesOf, pendingText } from '../domain/Badges';
import { orderExplanation, rankBranches } from '../domain/Ranking';
import { useReviewList } from '../hooks/useReviewList';
import { useReviewRoute } from '../hooks/useReviewRoute';
import { ReviewListPage } from '../pages/ReviewListPage';
import { listShellTabs } from '../pages/ReviewShellTabs';
import type { BranchRow, BranchRowView } from '../types';

function rowView(b: BranchRow): BranchRowView {
  const a = b.analysis;
  const commits = b.ahead === null ? '' : `${b.ahead} ${b.ahead === 1 ? 'commit' : 'commits'} ahead`;
  const files = a.state === 'done' ? `${a.files} ${a.files === 1 ? 'file' : 'files'}` : '';
  return {
    name: b.name,
    subject: b.subject,
    meta: [b.author, commits, files].filter(Boolean).join(' · '),
    current: b.current,
    badges: a.state === 'done' ? badgesOf(a) : null,
    pending: pendingText(a.state),
    error: a.state === 'error' ? a.error.message : null,
  };
}

/** Review mode, the list: local branches, each with the health badges the engine computed for it. */
export function ReviewListController() {
  const route = useReviewRoute();
  const list = useReviewList(route.base);
  const { state } = list;
  const data = state.data;
  const base = list.base;

  const tabs = listShellTabs(
    data && base
      ? { sourceLabel: data.source.label, base, baseSha: data.baseSha ?? null, refs: data.refs, count: data.branches.length, onBase: (n) => { list.setBase(n); route.openList(n); } }
      : null,
    GLOSSARY,
  );
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);

  return (
    <ReviewListPage
      loaded={state.loaded}
      error={state.error}
      list={
        data && base
          ? {
              base,
              rows: rankBranches(data.branches, state.order).map(rowView),
              order: state.order,
              explanation: orderExplanation(state.order),
              onOrder: list.setOrder,
              onOpen: (name) => route.openChange(base, name),
              onReload: list.reload,
            }
          : null
      }
    />
  );
}
