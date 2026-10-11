'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIST_OPTIONS, itemOptions } from '../domain/ChatOptions';
import { fixPick, fixStep } from '../domain/FixActions';
import { basePick, nameAsk } from '../domain/ItemActions';
import { itemExplain, itemIntro, itemMissing } from '../domain/ItemAnswers';
import { createPick, importAnswer } from '../domain/ListActions';
import { listExplain, listIntro, listMissing } from '../domain/ListAnswers';
import { stepAnswer } from '../domain/StepAnswer';
import type { AddPlanStep, ChatAsk, ChatMessage, FeatureChatView, LineFeaturesView } from '../types';

const call = (tool: string, args: Record<string, unknown>) => `${tool}(${JSON.stringify(args)})`;

/** cd1: the Features chat. Read options answer from what the read routes returned (project, feature detail); create
 * and fix add a plan step through `addStep` (the Plan panel's), which the person approves; nothing is written here.
 * The conversation starts again when the open feature changes (the side panel talks about that feature). */
export function useFeatureChat(view: LineFeaturesView, addStep: AddPlanStep): FeatureChatView {
  const { project, feature, detail, choose } = view;
  const [log, setLog] = useState<ChatMessage[]>([]);
  const [ask, setAsk] = useState<ChatAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const n = useRef(0);
  /** "Create something" picked a feature: start its Add flow once it is open. */
  const addNext = useRef(false);
  const id = (purpose: string) => `${purpose}#${++n.current}`;
  const you = (text: string): ChatMessage => ({ id: id('you'), from: 'you', text });
  const say = useCallback((...m: ChatMessage[]) => setLog((l) => [...l, ...m]), []);

  const latest = useRef(project);
  latest.current = project;
  useEffect(() => {
    setAsk(null);
    const p = latest.current;
    if (feature && p && addNext.current) {
      addNext.current = false;
      setLog([basePick(p, feature, `base#${++n.current}`)]);
      return;
    }
    setLog([]);
  }, [feature]);

  const ready = detail.phase === 'ready' ? detail.detail : null;
  const options = useMemo(() => (feature ? itemOptions(ready) : LIST_OPTIONS), [feature, ready]);
  const label = (optionId: string) => options.find((o) => o.id === optionId)?.label ?? optionId;

  const runStep = async (tool: string, args: Record<string, unknown>) => {
    setBusy(true);
    const r = await addStep({ tool, args });
    setBusy(false);
    say(stepAnswer(r, call(tool, args), id('step')));
    return r;
  };

  /** Two clicks: Add from the library, then the library item. The new item takes the suggested name; only when that
   * name is refused (taken, or not a valid name) does the chat ask for another one. */
  const addBasedOn = async (libraryId: string, name: string) => {
    if (!feature) return;
    const r = await runStep('line.baseOn', { libraryId, feature, name });
    if (!r.ok && (r.code === 'NAME_TAKEN' || r.code === 'BAD_NAME')) setAsk(nameAsk(libraryId, feature));
  };

  const onOption = (optionId: string) => {
    if (optionId === 'feature.back') return choose(null);
    if (!project) return;
    const me = you(label(optionId));
    const still: ChatMessage = { id: id('wait'), from: 'line', text: `Still reading ${feature ?? 'the project'}; ask again in a moment.` };
    const answers: Record<string, () => ChatMessage> = {
      'features.open': () => ({ id: id('open'), from: 'line', text: 'Which feature do you want to open?', pick: listIntro(project).pick }),
      'features.missing': () => listMissing(project, id('open')),
      'features.create': () => createPick(project, id('create')),
      'features.import': () => importAnswer(id('import')),
      'features.explain': () => listExplain(project, id('explain')),
      'feature.missing': () => (ready ? itemMissing(ready, id('missing')) : still),
      'feature.explain': () => (ready ? itemExplain(ready, id('explain')) : still),
      'feature.add': () => basePick(project, feature ?? '', id('base')),
      'feature.fix': () => (ready ? fixPick(ready, id('fix')) : still),
    };
    const answer = answers[optionId];
    if (answer) say(me, answer());
  };

  const onPick = (messageId: string, itemId: string) => {
    const purpose = messageId.split('#')[0];
    if (purpose === 'intro' || purpose === 'open') return choose(itemId);
    if (purpose === 'create') {
      addNext.current = true;
      return choose(itemId);
    }
    if (purpose === 'base' && feature) {
      const libName = project?.library.find((l) => l.id === itemId)?.name ?? itemId;
      say(you(`Base it on ${libName}`));
      return void addBasedOn(itemId, nameAsk(itemId, feature).suggestion);
    }
    if (purpose === 'fix') {
      const step = fixStep(itemId);
      say(you('Apply this fix'));
      void runStep(step.tool, step.args);
    }
  };

  const onAnswer = (askId: string, text: string) => {
    if (!feature || !askId.startsWith('name:')) return;
    setAsk(null);
    say(you(`Call it ${text}`));
    void addBasedOn(askId.slice('name:'.length), text);
  };

  const intro = feature ? itemIntro(feature) : project ? listIntro(project) : null;
  const messages = intro ? [intro, ...log] : log;
  return { options, messages, ask, busy, onOption, onPick, onAnswer, onCancelAsk: () => setAsk(null) };
}
