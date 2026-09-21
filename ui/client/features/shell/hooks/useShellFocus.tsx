'use client';

import { createContext, useContext } from 'react';

/** What a screen may ask of the shell about focus mode: is the Cockpit chrome
 * hidden, and the two actions that hide and restore it. Provided by the shell
 * around every screen. */
export type ShellFocusApi = {
  /** True while the rail, panes, top bar and drawer are hidden and the stage owns the viewport. */
  focused: boolean;
  /** Hides the Cockpit chrome. `label` names what is being shown, for the shell's own status/records. */
  enter: (label?: string) => void;
  /** Restores the previous layout. Safe to call when not focused. */
  exit: () => void;
};

const NOOP: ShellFocusApi = { focused: false, enter: () => {}, exit: () => {} };

export const ShellFocusContext = createContext<ShellFocusApi>(NOOP);

/** Focus mode: a screen (today the Pages Editor's live preview) asks the shell to
 * stand down — rail, Browser/Tools panes, top bar, drawer and status bar go away so
 * the thing under development fills the viewport, and Esc brings the Cockpit back.
 * The shell keeps owning the layout; the screen never forks it. A no-op outside the shell. */
export function useShellFocus(): ShellFocusApi {
  return useContext(ShellFocusContext);
}
