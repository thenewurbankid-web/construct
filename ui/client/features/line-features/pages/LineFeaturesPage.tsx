import type { ReactNode } from 'react';
import { LiveStageController, ModesFrameController } from '@/features/line-modes';
import { FeaturesView } from '../components/FeaturesView';
import '../components/line-features.css';
import type { Crumb, FeatureChatView, LineFeaturesView, LineMode, StageBlock } from '../types';

type LineFeaturesPageProps = {
  view: LineFeaturesView;
  chat: FeatureChatView;
  plan?: ReactNode;
  workflows?: ReactNode;
  trace?: ReactNode;
  /** Two modes: the person's mode, the breadcrumb (chat mode) and what a crumb does. */
  mode?: LineMode;
  crumbs?: Crumb[];
  onCrumb?: (crumb: Crumb) => void;
  /** Chat mode's live stage: the active blocks. */
  blocks?: StageBlock[];
};

const NO_CRUMBS: Crumb[] = [];
const NO_BLOCKS: StageBlock[] = [];

/** cd1: the Features screen of a Line project, in Line style. Chat mode: it opens as a full-screen chat (create, open,
 * what is missing, import, explain); picking a feature opens its page (items by kind, Auto summary, spec coverage) and
 * the chat moves to a side panel with that feature's options, the Plan panel under it. Under the hood: the feature
 * cards (or the open feature's page) with the same chat as a helper beside it. */
export function LineFeaturesPage({ view, chat, plan, workflows = null, trace = null, mode = 'chat', crumbs = NO_CRUMBS, onCrumb = () => {}, blocks = NO_BLOCKS }: LineFeaturesPageProps) {
  const { feature } = view;
  return (
    <div className="lf" data-testid="line-features">
      {trace}
      <ModesFrameController
        screen="features"
        mode={mode}
        crumbs={crumbs}
        onCrumb={onCrumb}
        open={feature}
        stage={<LiveStageController blocks={blocks} revision={`${feature}/${view.item}/${view.part}/${view.detail.phase}`} />}
        view={<FeaturesView view={view} workflows={workflows} />}
        chat={{
          title: chat.title,
          testId: 'lf-chat-entry',
          options: chat.options,
          messages: chat.messages,
          ask: chat.ask,
          busy: chat.busy,
          onOption: chat.onOption,
          onPick: chat.onPick,
          onAnswer: chat.onAnswer,
          onCancelAsk: chat.onCancelAsk,
          footer: plan,
        }}
      />
    </div>
  );
}
