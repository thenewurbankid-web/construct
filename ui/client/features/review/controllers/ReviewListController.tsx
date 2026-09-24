'use client';

import { useRegisterShellTab } from '@/features/shell';
import { GLOSSARY } from '../domain/BadgeGlossary';
import { badgesOf, pendingText } from '../domain/Badges';
import { orderExplanation, rankBranches } from '../domain/Ranking';
import { describeFailure } from '../domain/FailureView';
import { useFailureActions } from '../hooks/useFailureActions';
import { useReviewList } from '../hooks/useReviewList';
import { listData } from '../workflows/ListMachine';
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
    stopped: a.state === 'cancelled' ? 'Cancelled' : null,
    error: a.state === 'error' ? a.error.message : null,
  };
}

/** Review mode, the list: local branches, each with the health badges the engine computed for it. */
export function ReviewListController() {
  const route = useReviewRoute();
  const list = useReviewList(route.base);
  const { state } = list;
  const data = listData(state);
  const base = list.base;
  const onFailureAction = useFailureActions({ retry: list.reload, list: list.reload });

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
      loaded={state.status === 'ready' || state.status === 'error'}
      failure={state.status === 'error' ? describeFailure(state.errorCode, state.error) : null}
      noBranches={!!data && !data.base}
      onFailureAction={onFailureAction}
      list={
        data && base
          ? {
              base,
              rows: rankBranches(data.branches, list.order).map(rowView),
              order: list.order,
              explanation: orderExplanation(list.order),
              onOrder: list.setOrder,
              onOpen: (name) => route.openChange(base, name),
              onReload: list.reload,
            }
          : null
      }
    />
  );
}
