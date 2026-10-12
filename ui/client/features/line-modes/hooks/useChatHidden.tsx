'use client';

import { useCallback, useEffect, useState } from 'react';

const HIDDEN_KEY = 'cockpit.mode.chatHidden';

/** Under the hood: whether the person hid the chat helper (remembered in this browser). */
export function useChatHidden(): [boolean, () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      // Storage blocked: the chat starts shown.
    }
  }, []);
  const toggle = useCallback(
    () =>
      setHidden((h) => {
        try {
          window.localStorage.setItem(HIDDEN_KEY, h ? '0' : '1');
        } catch {
          // Storage blocked: the choice lasts until the tab closes.
        }
        return !h;
      }),
    [],
  );
  return [hidden, toggle];
}
