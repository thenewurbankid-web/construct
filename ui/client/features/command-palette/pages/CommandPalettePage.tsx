import { CommandPalette } from '../components/CommandPalette';
import type { PaletteViewProps } from '../types';

// Presentation-only: all state comes from the controller.
export function CommandPalettePage(props: PaletteViewProps) {
  return <CommandPalette {...props} />;
}
