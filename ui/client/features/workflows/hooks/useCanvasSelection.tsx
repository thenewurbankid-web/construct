'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SelectedEdge } from '../types';

/** What the diagram and the tools tabs share: which machine of the open file
 * the tabs act on, the event name typed for new transitions, the selected
 * arrow and the "type an event name first" hint. Reset whenever another file
 * is opened; kept across a confirmed edit of the same file. */
export function useCanvasSelection(file: string) {
  const [machineIndex, setMachineIndex] = useState(0);
  const [eventName, setEventName] = useState('');
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setMachineIndex(0);
    setEventName('');
    setSelectedEdge(null);
    setHint(null);
  }, [file]);

  // Picking another machine drops an arrow selected on the previous one.
  const pickMachine = useCallback((index: number) => {
    setMachineIndex((cur) => {
      if (cur !== index) {
        setSelectedEdge(null);
        setHint(null);
      }
      return index;
    });
  }, []);

  return { machineIndex, pickMachine, eventName, setEventName, selectedEdge, setSelectedEdge, hint, setHint };
}
