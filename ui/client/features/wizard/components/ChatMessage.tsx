import { AttributionBadge } from '@/components/AttributionBadge';
import type { ChatMessageData } from '../types';

// Presentation-only — `message.attribution` arrives already parsed (see
// the workflow layer's pushMessage helper), so this never touches the
// domain layer's regex parsing itself (COMPONENT-002, COMPONENT-003).
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
  // #599 -- two kinds of live output, told apart by a label AND a style (not colour alone):
  // `step` is the framework (deterministic Construct); `thought` is the model's own streamed text.
  if (message.role === 'step') {
    return (
      <div className="chat-message chat-step">
        <span className="chat-badge chat-badge--framework">Framework</span> {message.text}
        {message.reason && <div className="chat-reason">Why: {message.reason}</div>}
      </div>
    );
  }
  if (message.role === 'thought') {
    return (
      <div className="chat-message chat-thought">
        <span className="chat-badge chat-badge--model">Model</span> {message.text}
      </div>
    );
  }
  if (message.role === 'question') return <div className="chat-message chat-question">{message.text}</div>;
  if (message.role === 'answer') {
    // A blank answer is meaningful (e.g. "finish adding routes") — show that it registered (#40).
    if (!message.text.trim()) return <div className="chat-message chat-answer chat-answer-blank">(blank)</div>;
    return <div className="chat-message chat-answer">{message.text}</div>;
  }
  if (message.role === 'error') return <div className="chat-message chat-error">{message.text}</div>;
  return <div className="chat-message chat-system">{message.text}</div>;
}
