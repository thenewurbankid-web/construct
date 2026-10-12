import type { ReactNode } from 'react';
import { ChatEntry } from '@/lib/ChatEntry';
import { KnowsTabBar } from '../components/KnowsTabBar';
import '../components/line-knows.css';
import type { KnowsScreen } from '../types';

/** "What Line knows": the chat (lib/ChatEntry.tsx) beside the open tab. Plain English first; details sit under Details. */
export function LineKnowsPage({ screen, panel }: { screen: KnowsScreen; panel: ReactNode }) {
  return (
    <ChatEntry title="What Line knows" options={screen.options} messages={screen.messages} selected={screen.tab} onOption={screen.onOption} onPick={() => {}} testId="line-knows">
      <div className="lk" data-testid="knows-page">
        <h1>What Line knows</h1>
        <p className="lk-lead">What Line has learned about your project, what it remembers from your decisions, and how well it does. Everything stays on this computer.</p>
        <KnowsTabBar tabs={screen.tabs} current={screen.tab} onPick={screen.setTab} />
        <section className="lk-panel" role="tabpanel" id={`knows-panel-${screen.tab}`} aria-labelledby={`knows-tab-${screen.tab}`} data-testid={`knows-panel-${screen.tab}`}>
          {panel}
        </section>
      </div>
    </ChatEntry>
  );
}
