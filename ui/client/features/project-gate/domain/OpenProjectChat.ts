// Pure (DOMAIN-001): the Your projects chat helper's answers, in plain words, with its option chips (stable ids) and,
// when a request needs one more answer, the one question it asks. What appears is decided here from the request's
// intent and the workspace's projects; nothing is written by a model.
import type { ChatAsk, ChatItem, ChatMessage, ChatOption } from '../../../lib/lineChat.ts';
import type { OpenProjectIntent } from '../types.ts';

/** The requests the Open-a-project chat reads itself (the screen answers them, then Auto fills the real controls).
 * Their ids are the two-modes provider's ("open.*", OpenModes.ts). */
export const HELPER_OPTIONS: ChatOption[] = [
  { id: 'open.new', label: 'Start a new project', sentence: 'Asks for a name and fills in the New project questions.', effect: 'read' },
  { id: 'open.github', label: 'Bring in from GitHub', sentence: 'Asks for the link and fills in the From GitHub questions.', effect: 'read' },
  { id: 'open.list', label: 'Show my projects', sentence: 'Lists your projects; one click opens one.', effect: 'read' },
  { id: 'open.line', label: 'What is a Line project?', sentence: 'Says what a Line project starts with.', effect: 'read' },
];

const cards = (projects: string[]): ChatItem[] => projects.map((p) => ({ id: p, name: p, text: 'Open this project.', control: 'open-project.card' }));

export type HelperReply = { text: string; tone?: 'plain' | 'refusal'; pick?: ChatMessage['pick']; ask?: ChatAsk | null };

/** The helper's answer to a request. `projects`: the workspace's project names. */
export function helperReply(intent: OpenProjectIntent, projects: string[]): HelperReply {
  switch (intent.kind) {
    case 'secret':
      return { tone: 'refusal', text: 'That looks like an access token, so I did not keep it. Type a token only in the token field, after "Is it private?".' };
    case 'explain':
      return { text: 'A Line project starts with a small library (a button, a text field, a card, a list page and a sample record) and one empty part of the app. Every change is checked, so it starts with no problems.' };
    case 'new':
      if (!intent.name) return { text: 'Sure. What should we call it?', ask: { id: 'open-project.name', label: 'What should we call it?', suggestion: '', submit: 'Next' } };
      return { text: `I am filling in a new ${intent.framework === 'line' ? 'Line project' : 'project'} called ${intent.name}. Check it, then click Create.` };
    case 'github':
      if (!intent.link) return { text: 'Sure. Paste the GitHub link.', ask: { id: 'open-project.link', label: 'Paste the GitHub link', suggestion: '', submit: 'Next' } };
      return { text: `I am filling in ${intent.link}. Answer "Is it private?" yourself, then click Bring it in.` };
    case 'open':
      if (intent.project) return { text: `Opening ${intent.project}.` };
      return { tone: 'refusal', text: `There is no project called ${intent.wanted} in your workspace. Pick one of yours.`, pick: { label: 'Your projects', items: cards(projects) } };
    case 'list':
      if (!projects.length) return { text: 'You have no projects yet. Start one in a click.' };
      // The cards are Line elements inside the answer (lib/StreamedText.tsx); the list comes from the workspace, not a model.
      return { text: `Here are your projects: ${projects.map((p) => `<ProjectCard name="${p}"/>`).join(' ')} One click opens one.` };
    default:
      return { text: 'I can start a new project, bring one in from GitHub, or open one of yours.' };
  }
}
