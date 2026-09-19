'use client';

import { useEffect, useRef } from 'react';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/features/states';
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
      {messages.length === 0 && (
        <EmptyState size="inline" title="No session yet" hint="Start a wizard session above and the conversation will appear here." />
      )}
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
      <div ref={bottomRef} />
    </GlassPanel>
  );
}
