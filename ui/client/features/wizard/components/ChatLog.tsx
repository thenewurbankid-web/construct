'use client';

import { useEffect, useRef } from 'react';
import { GlassPanel } from '@/components/ui';
import type { ChatMessageData } from '../types';
import { ChatMessage } from './ChatMessage';

// Presentation-only, plus the auto-scroll-into-view behavior — purely
// local UI state (a ref + an effect keyed on the messages it was handed),
// which README's non-negotiable defaults explicitly allow components to own.
export function ChatLog({ messages }: { messages: ChatMessageData[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <GlassPanel className="chat">
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
      <div ref={bottomRef} />
    </GlassPanel>
  );
}
