import type { ShellTab } from '@/features/shell';
import { StoryTabController } from './StoryTabController';

// #387: the AI-assisted story flows as a shell tab (Browser), beside Notes, Features, Blocks and Rules
// (#781's precedent) -- the Features screen registers it while mounted; the tab's body only fetches once opened.
export function storyShellTab(): ShellTab {
  return { id: 'story', title: 'Story', render: () => <StoryTabController /> };
}
