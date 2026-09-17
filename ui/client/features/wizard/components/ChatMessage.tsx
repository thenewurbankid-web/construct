import { AttributionBadge } from '@/components/AttributionBadge';
import type { ChatMessageData } from '../types';

// Presentation-only — `message.attribution` arrives already parsed (see
// workflows/Wizard.tsx's pushMessage), so this never touches domain/regex
// logic itself (COMPONENT-002/003).
export function ChatMessage({ message }: { message: ChatMessageData }) {
  if (message.role === 'log') {
    if (message.attribution) {
      return (
        <div className="chat-message chat-log">
          <AttributionBadge attribution={message.attribution} />
        </div>
      );
    }
    if (!message.text.trim()) return null;
    return <div className="chat-message chat-log">{message.text}</div>;
  }
  if (message.role === 'question') return <div className="chat-message chat-question">{message.text}</div>;
  if (message.role === 'answer') return <div className="chat-message chat-answer">{message.text}</div>;
  if (message.role === 'error') return <div className="chat-message chat-error">{message.text}</div>;
  return <div className="chat-message chat-system">{message.text}</div>;
}
