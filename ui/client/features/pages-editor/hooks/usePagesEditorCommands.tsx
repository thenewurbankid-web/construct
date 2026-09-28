'use client';

import { useMemo } from 'react';
import { useRegisterCommands, type Command } from '@/features/command-palette';
import { pageCommandSpecs } from '../domain/PageCommands';

/** #375 Ctrl P quick-open: registers a "Go to page" command per page of the project into the
 * shell's command palette (also opened by Ctrl P, see PaletteBrowser.ts), so typing a feature or
 * file name jumps straight to it. Mounted only while the Pages Editor is (usePagesEditor), so the
 * entries disappear with the screen like the rest of its state. */
export function usePagesEditorCommands(pages: { feature: string; file: string }[], openPageOf: (feature: string, file: string) => void): void {
  const commands = useMemo<Command[]>(
    () => pageCommandSpecs(pages).map(({ feature, file, ...spec }) => ({ ...spec, run: () => openPageOf(feature, file) })),
    [pages, openPageOf],
  );
  useRegisterCommands(commands);
}
