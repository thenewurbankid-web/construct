import type { ReactNode } from 'react';
import { ModesFrame } from '@/features/line-modes';
import { FeatureCardList } from '../components/FeatureCardList';
import { FeatureDetailPanel } from '../components/FeatureDetailPanel';
import '../components/line-features.css';
import type { Crumb, FeatureChatView, LineFeaturesView, LineMode } from '../types';

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
};

const NO_CRUMBS: Crumb[] = [];

/** cd1: the Features screen of a Line project, in Line style. Chat mode: it opens as a full-screen chat (create, open,
 * what is missing, import, explain); picking a feature opens its page (items by kind, Auto summary, spec coverage) and
 * the chat moves to a side panel with that feature's options, the Plan panel under it. Under the hood: the feature
 * cards (or the open feature's page) with the same chat as a helper beside it. */
export function LineFeaturesPage({ view, chat, plan, workflows = null, trace = null, mode = 'chat', crumbs = NO_CRUMBS, onCrumb = () => {} }: LineFeaturesPageProps) {
  const { feature, detail, tab, chooseTab, item, part } = view;
  const page = feature ? (
    <>
      <header className="lf-head">
        <h1 className="lf-title">{feature}</h1>
        <p className="ln-muted">A feature owns its pages, components, workflows and fixtures; each one is based on one item from your library.</p>
      </header>
      <FeatureDetailPanel feature={feature} detail={detail} tab={tab} onTab={chooseTab} workflows={workflows} item={item} part={part} />
    </>
  ) : (
    <>
      <header className="lf-head">
        <h1 className="lf-title">Features</h1>
        <p className="ln-muted">Pick a feature to see everything it owns.</p>
      </header>
      <FeatureCardList features={view.features} current={feature} onChoose={view.choose} />
    </>
  );
  return (
    <div className="lf" data-testid="line-features">
      {trace}
      <ModesFrame
        screen="features"
        mode={mode}
        crumbs={crumbs}
        onCrumb={onCrumb}
        open={feature}
        view={page}
        chat={{
          title: feature ? `Ask about ${feature}` : 'Features',
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
