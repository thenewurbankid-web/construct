import type { LineMode } from '@/lib/lineModes';

type ModeSwitchProps = { mode: LineMode; onMode: (mode: LineMode) => void };

/** The shell's one global switch between the two modes, on every screen. */
export function ModeSwitch({ mode, onMode }: ModeSwitchProps) {
  return (
    <span className="lm-switch" role="group" aria-label="Mode" data-testid="lm-switch" data-mode={mode}>
      <button type="button" className="lm-switch-btn" aria-pressed={mode === 'chat'} data-testid="lm-mode-chat" data-line-control="shell.modeChat" title="Chat: the screen as a conversation with its own options" onClick={() => onMode('chat')}>
        Chat
      </button>
      <button type="button" className="lm-switch-btn" aria-pressed={mode === 'hood'} data-testid="lm-mode-hood" data-line-control="shell.modeHood" title="Under the hood: the regular screen, with the chat as a helper" onClick={() => onMode('hood')}>
        Under the hood
      </button>
    </span>
  );
}
