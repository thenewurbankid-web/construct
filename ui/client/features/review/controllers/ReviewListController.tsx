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
import { GitPrsTabController } from './GitPrsTabController';
import { ReviewListPage } from '../pages/ReviewListPage';
import { gitChangesTab, gitCommitTab, gitCommitsTab, listShellTabs } from '../pages/ReviewShellTabs';
import type { BranchListProps, BranchRow, BranchRowView } from '../types';

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
  // #374 (Git screen shell): "Changes" registers first so the left tab strip reads Changes | Branches
  // | PRs | Commits, left to right, matching ia-git.html -- registration order is render order (see
  // ReviewShellTabs.tsx's header comment for why none of this is `preferred`).
  useRegisterShellTab('browser', gitChangesTab());
  useRegisterShellTab('browser', tabs.browser);
  useRegisterShellTab('tools', tabs.tools);

  const listProps: BranchListProps | null =
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
      : null;

  // #374 (Git screen shell): additive tabs. None of these is `preferred`, so `review-sources` stays
  // the default browser tab and `review-legend` stays the default tools tab exactly as before --
  // see ReviewShellTabs.tsx's header comment.
  useRegisterShellTab('browser', { id: 'git-prs', title: 'PRs', badge: listProps ? listProps.rows.length : null, render: () => <GitPrsTabController list={listProps} /> });
  useRegisterShellTab('browser', gitCommitsTab());
  useRegisterShellTab('tools', gitCommitTab());

  return (
    <ReviewListPage
      loaded={state.status === 'ready' || state.status === 'error'}
      failure={state.status === 'error' ? describeFailure(state.errorCode, state.error) : null}
      noBranches={!!data && !data.base}
      onFailureAction={onFailureAction}
      list={listProps}
    />
  );
}
