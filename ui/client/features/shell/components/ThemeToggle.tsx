import type { ThemeToggleProps } from '../types';

/** Small icon button: switches dark <-> light. Announces the state it will
 * switch to (a state-changing label, so no aria-pressed). */
export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="sh-icon-btn"
      data-testid="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}
