/** A thing the palette can run. Features register these (useRegisterCommands);
 * the palette only knows this shape (props in, `run` out). */
export type Command = {
  /** Stable, unique id, e.g. `go.pages`. Registering the same id again replaces the command. */
  id: string;
  title: string;
  /** Extra words the fuzzy search matches (synonyms, layer names). */
  keywords?: string[];
  /** Section heading in the palette, e.g. `Go to`, `View`, `Project`. */
  group: string;
  /** Shortcut hint shown on the row, e.g. `Ctrl J`. Display only. */
  hint?: string;
  run: () => void;
};

export type CommandGroup = { group: string; commands: Command[] };

export type PaletteViewProps = {
  open: boolean;
  query: string;
  onQuery: (query: string) => void;
  /** Filtered commands, in display order. */
  groups: CommandGroup[];
  /** Index into the flat list of `groups`' commands. */
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onRun: (command: Command) => void;
  onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
  onClose: () => void;
  emptyLabel: string;
};

export type ShortcutLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };
