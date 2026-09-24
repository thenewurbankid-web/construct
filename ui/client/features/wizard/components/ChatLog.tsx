'use client';

import { useStickToBottom } from 'use-stick-to-bottom';
import type { ChatMessageData } from '../types';
import { ChatMessage } from './ChatMessage';

// Presentation-only. Scrolling is a headless library's job (use-stick-to-bottom, MIT): it follows new content while
// the reader is at the bottom and stops following the moment they scroll up to read, showing "Jump to latest".
export function ChatLog({ messages }: { messages: ChatMessageData[] }) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ resize: 'smooth', initial: 'instant' });

  return (
    <div className="chat-wrap">
      <div className="glass-panel chat" ref={scrollRef} role="log" aria-label="Import conversation">
        <div className="chat-content" ref={contentRef}>
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
        </div>
      </div>
      {!isAtBottom && (
        <button type="button" className="chat-jump" onClick={() => void scrollToBottom()}>
          Jump to latest
        </button>
      )}
    </div>
  );
}
