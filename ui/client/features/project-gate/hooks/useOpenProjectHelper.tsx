'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { startAutoRun, updateTraceSettings } from '@/features/line-trace';
import type { ChatAsk, ChatMessage } from '@/lib/lineChat';
import { HELPER_OPTIONS, helperReply } from '../domain/OpenProjectChat';
import { requestForAnswer, requestForOption } from '../domain/OpenProjectChatRequests';
import { readOpenProjectRequest } from '../domain/OpenProjectRequest';
import { traceToolFor } from '../domain/OpenProjectScript';
import { openProjectTraceApi } from '../services/OpenProjectTraceApi';

const FIRST: ChatMessage = { id: 'hello', from: 'line', text: 'Ask me in plain words, for example "start a shop called acme-store" or "open line-sample".' };
const REQUEST_BOX: ChatAsk = { id: 'open-project.request', label: 'Your request', suggestion: '', submit: 'Ask' };
const SECRET_SHOWN = 'A message with an access token (not kept).';

/** The Your projects chat helper: reads a plain request statically, answers with option chips (or the one question it
 * still needs), fills the question series by playing Auto's moves on the real controls (Auto stops before Create and
 * Bring it in), and sets Trace's request so the matching controls light up when Trace is on. A token is never kept,
 * shown or sent: only the person types it, in the token field. */
export function useOpenProjectHelper(list: { name: string; path: string }[] | null, onOpen: (dir: string) => void) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([FIRST]);
  const [ask, setAsk] = useState<ChatAsk | null>(null);
  const seq = useRef(0);
  const projects = useMemo(() => list ?? [], [list]);
  const names = useMemo(() => projects.map((p) => p.name), [projects]);
  const traceApi = useMemo(() => openProjectTraceApi(names), [names]);

  const respond = useCallback(
    (request: string, shown: string) => {
      const intent = readOpenProjectRequest(request, names);
      const reply = helperReply(intent, names);
      const tool = traceToolFor(intent);
      const id = () => `m${(seq.current += 1)}`;
      const you: ChatMessage = { id: id(), from: 'you', text: intent.kind === 'secret' ? SECRET_SHOWN : shown };
      const details = [`Read as: ${intent.kind}`, ...(tool ? [`Tool: ${tool.toolId}`] : [])];
      setMessages((m) => [...m, you, { id: id(), from: 'line', text: reply.text, tone: reply.tone, pick: reply.pick, details }]);
      setAsk(reply.ask ?? null);
      if (intent.kind === 'secret') return;
      updateTraceSettings((s) => ({ ...s, request: request.slice(0, 300) }));
      if (tool?.script.length) startAutoRun(request, tool.script);
    },
    [names],
  );

  const openProject = useCallback(
    (name: string) => {
      const p = projects.find((x) => x.name === name);
      if (p) onOpen(p.path);
    },
    [projects, onOpen],
  );

  return {
    open,
    setOpen,
    traceApi,
    openProject,
    chat: {
      title: 'Ask for help',
      options: HELPER_OPTIONS,
      messages,
      selected: null,
      ask,
      input: REQUEST_BOX,
      onOption: (optionId: string) => respond(requestForOption(optionId), HELPER_OPTIONS.find((o) => o.id === optionId)?.label ?? optionId),
      onAnswer: (askId: string, text: string) => respond(askId === REQUEST_BOX.id ? text : requestForAnswer(askId, text), text),
      onCancelAsk: () => setAsk(null),
      onPick: (_messageId: string, itemId: string) => openProject(itemId),
    },
  };
}
