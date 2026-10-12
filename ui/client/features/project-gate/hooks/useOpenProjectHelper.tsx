'use client';

import { useCallback, useMemo, useState } from 'react';
import { startAutoRun, updateTraceSettings } from '@/features/line-trace';
import type { ScreenControl } from '@/features/line-modes';
import type { ChatAsk } from '@/lib/lineChat';
import { HELPER_OPTIONS, helperReply } from '../domain/OpenProjectChat';
import { requestForAnswer, requestForOption } from '../domain/OpenProjectChatRequests';
import { readOpenProjectRequest } from '../domain/OpenProjectRequest';
import { traceToolFor } from '../domain/OpenProjectScript';
import { OPEN_SECTIONS } from '../domain/OpenModes';
import { openProjectTraceApi } from '../services/OpenProjectTraceApi';
import type { OpenProjectIntent } from '../types';

/** The request box under the options of the Open-a-project chat. */
export const OPEN_REQUEST_BOX: ChatAsk = { id: 'open-project.request', label: 'Your request', suggestion: '', submit: 'Ask' };
const SECRET_SHOWN = 'A message with an access token (not kept).';
/** The way in Auto fills, so Chat mode opens it beside the chat first (OpenModes.ts sections). */
const SECTION_FOR: Partial<Record<OpenProjectIntent['kind'], string>> = { new: 'new', github: 'clone' };

/** The Open-a-project chat's own answers, in the screen's two-modes chat: it reads a plain request statically, answers
 * in the chat (option chips, project cards, or the one question it still needs), fills the question series by playing
 * Auto's moves on the real controls (Auto stops before Create and Bring it in) and sets Trace's request so the matching
 * controls light up when Trace is on. In Chat mode it first opens the way in beside the chat, so the controls are on
 * screen. A token is never kept, shown or sent: only the person types it, in the token field. */
export function useOpenProjectHelper(list: { name: string; path: string }[] | null, onOpen: (dir: string) => void) {
  const [ask, setAsk] = useState<ChatAsk | null>(null);
  const projects = useMemo(() => list ?? [], [list]);
  const names = useMemo(() => projects.map((p) => p.name), [projects]);
  const traceApi = useMemo(() => openProjectTraceApi(names), [names]);

  const respond = useCallback(
    (request: string, shown: string, control: ScreenControl) => {
      const intent = readOpenProjectRequest(request, names);
      const reply = helperReply(intent, names);
      const tool = traceToolFor(intent);
      const details = [`Read as: ${intent.kind}`, ...(tool ? [`Tool: ${tool.toolId}`] : [])];
      const auto = intent.kind !== 'secret' && Boolean(tool?.script.length);
      // Chat mode: open the way in Auto fills beside the chat first (the chat starts again there), then answer.
      const section = SECTION_FOR[intent.kind];
      if (auto && control.mode === 'chat' && section && control.place.steps[0]?.id !== section) {
        const label = OPEN_SECTIONS.find((s) => s.id === section)?.name ?? section;
        control.go({ screen: control.place.screen, steps: [{ param: 'section', id: section, label }] });
      }
      control.reply({ text: reply.text, tone: reply.tone, pick: reply.pick, details }, intent.kind === 'secret' ? SECRET_SHOWN : shown);
      setAsk(reply.ask ?? null);
      if (intent.kind === 'secret') return;
      updateTraceSettings((s) => ({ ...s, request: request.slice(0, 300) }));
      if (auto && tool) startAutoRun(request, tool.script);
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

  /** An option of the chat: true when it is one of the helper's (answered here). */
  const onOption = useCallback(
    (optionId: string, control: ScreenControl) => {
      if (!HELPER_OPTIONS.some((o) => o.id === optionId)) return false;
      respond(requestForOption(optionId), HELPER_OPTIONS.find((o) => o.id === optionId)?.label ?? optionId, control);
      return true;
    },
    [respond],
  );

  const onAnswer = useCallback(
    (askId: string, text: string, control: ScreenControl) => respond(askId === OPEN_REQUEST_BOX.id ? text : requestForAnswer(askId, text), text, control),
    [respond],
  );

  return { traceApi, openProject, ask, input: OPEN_REQUEST_BOX, onOption, onAnswer, onCancelAsk: () => setAsk(null) };
}
