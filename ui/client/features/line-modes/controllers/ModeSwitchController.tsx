'use client';

import { ModeSwitch } from '../components/ModeSwitch';
import '../components/line-modes.css';
import { useLineMode } from '../hooks/useLineMode';

/** The shell's mode switch, wired to the person's remembered mode. */
export function ModeSwitchController() {
  const { mode, setMode } = useLineMode();
  return <ModeSwitch mode={mode} onMode={setMode} />;
}
