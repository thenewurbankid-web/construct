'use client';

import { useMemo, type ReactNode } from 'react';
import { ChatEntry } from '@/lib/ChatEntry';
import type { ChatEntryProps } from '@/lib/lineChat';
import type { StreamElements } from '@/lib/StreamedText';

type OpenProjectHelperProps = {
  open: boolean;
  onOpen: (open: boolean) => void;
  chat: Omit<ChatEntryProps, 'footer' | 'children' | 'elements'>;
  /** Opens a project by name (a ProjectCard inside an answer). */
  onOpenProject: (name: string) => void;
  /** The Trace bar (Trace, Auto, "Let Auto approve in this session"), under the chat. */
  trace: ReactNode;
};

/** A project as a card inside an answer: one click opens it. */
function ChatProjectCard({ name, onOpenProject }: { name: string; onOpenProject: (name: string) => void }) {
  return (
    <button type="button" className="ln-project-card op-chat-card" onClick={() => onOpenProject(name)} aria-label={`Open ${name}`} data-testid="chat-project-card" data-line-control="open-project.card" data-line-target={name}>
      <span className="ln-project-name">{name}</span>
    </button>
  );
}

/** Presentation-only chat helper of the Your projects screen: a small "Ask for help" button, so the screen stays calm;
 * opened, a panel with the chat (option chips, a request box) and the Trace bar under it. */
export function OpenProjectHelper({ open, onOpen, chat, trace, onOpenProject }: OpenProjectHelperProps) {
  const elements = useMemo<StreamElements>(() => ({ ProjectCard: ({ name }) => <ChatProjectCard name={name ?? ''} onOpenProject={onOpenProject} /> }), [onOpenProject]);
  if (!open) {
    return (
      <button type="button" className="ln-btn op-help-toggle" onClick={() => onOpen(true)} aria-expanded={false} data-testid="open-helper">
        Ask for help
      </button>
    );
  }
  return (
    <aside className="op-help" aria-label="Help" data-testid="open-helper-panel">
      <button type="button" className="ln-btn ln-btn--ghost ln-btn--sm op-help-close" onClick={() => onOpen(false)} aria-expanded data-testid="close-helper">
        Close help
      </button>
      <ChatEntry {...chat} layout="panel" testId="open-helper-chat" footer={trace} elements={elements} />
    </aside>
  );
}
