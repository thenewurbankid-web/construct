import type { ReactNode } from 'react';
import { ChatEntry } from '@/lib/ChatEntry';
import { FeatureDetailPanel } from '../components/FeatureDetailPanel';
import '../components/line-features.css';
import type { FeatureChatView, LineFeaturesView } from '../types';

type LineFeaturesPageProps = { view: LineFeaturesView; chat: FeatureChatView; plan?: ReactNode };

/** cd1: the Features screen of a Line project, in Line style. It opens as a full-screen chat (create, open, what is
 * missing, import, explain); picking a feature opens its page (items by kind, Auto summary, spec coverage) and the chat
 * moves to a side panel with that feature's options, the Plan panel under it. */
export function LineFeaturesPage({ view, chat, plan }: LineFeaturesPageProps) {
  const { feature, detail } = view;
  return (
    <div className="lf" data-testid="line-features">
      <ChatEntry
        title={feature ? `Ask about ${feature}` : 'Features'}
        testId="lf-chat-entry"
        selected={feature}
        options={chat.options}
        messages={chat.messages}
        ask={chat.ask}
        busy={chat.busy}
        onOption={chat.onOption}
        onPick={chat.onPick}
        onAnswer={chat.onAnswer}
        onCancelAsk={chat.onCancelAsk}
        footer={plan}
      >
        <header className="lf-head">
          <p className="ln-eyebrow">Feature</p>
          <h1 className="lf-title">{feature}</h1>
          <p className="ln-muted">A feature owns its pages, components, workflows and fixtures; each one is based on one item from your library.</p>
        </header>
        <FeatureDetailPanel feature={feature} detail={detail} />
      </ChatEntry>
    </div>
  );
}
