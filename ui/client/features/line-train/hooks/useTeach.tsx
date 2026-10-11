'use client';

import { useMemo } from 'react';
import { slotChoices } from '../domain/SlotChoices';
import { routeCards } from '../domain/RouteCards';
import { routeArgs, routeFields } from '../domain/RouteFields';
import type { TeachControls, TrainChoices, TrainHttp, TrainWorld } from '../types';
import { useDraft } from './useDraft';
import { useRouteActions } from './useRouteActions';

type World = { worlds: TrainWorld[]; world: string; choose: (k: string) => void; choices: TrainChoices | null; reloadChoices: () => Promise<void> };

/** The "Teach a new request" panel: type or pick a request, read the drafter's routes, correct them with closed
 * choices, Try each one in a scratch copy, save the case. */
export function useTeach(api: TrainHttp, w: World, onSaved: () => void, onError: (s: string | null) => void): TeachControls {
  const d = useDraft(api, w.world, onError);
  const r = useRouteActions(api, d, onSaved, onError);
  const slots = useMemo(() => slotChoices(d.edit, w.choices, d.values), [d.edit, w.choices, d.values]);
  const cards = useMemo(() => routeCards(d.edit, r.tries), [d.edit, r.tries]);
  const fieldsFor = (tool: string) => routeFields(tool, w.choices);
  const intents = w.choices?.intents ?? [];
  return {
    worlds: w.worlds, world: w.world, chooseWorld: w.choose, suggestions: w.choices?.suggestions ?? [],
    text: d.text, setText: d.setText,
    submit: () => { r.reset(); void d.submit(); },
    pick: (t) => { r.reset(); d.setText(t); void d.submit(t); },
    edit: d.edit,
    intentPhrase: intents.find((i) => i.id === d.edit?.intent)?.phrase ?? '',
    intents, setIntent: d.setIntent,
    unknown: d.meta?.unknown ?? [], meant: (word, ref) => void d.meant(word, ref).then(w.reloadChoices),
    slots, setSlot: (name, value) => d.setSlot(name, value, slots.find((s) => s.name === name)?.kind ?? 'pick'),
    cards, toggleValid: r.toggleValid, star: r.star, tryRoute: (id) => void r.tryRoute(id),
    tools: w.choices?.tools ?? [], fieldsFor,
    addRoute: (tool, values) => void r.addRoute(tool, routeArgs(tool, values, fieldsFor(tool))),
    save: () => void r.save(), saved: r.saved,
  };
}
