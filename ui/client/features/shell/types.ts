export type ShellId = string;

/** The two supported colour themes. Dark is the default (owner decision). */
export type Theme = 'dark' | 'light';

export type ThemeToggleProps = {
  theme: Theme;
  onToggle: () => void;
};
