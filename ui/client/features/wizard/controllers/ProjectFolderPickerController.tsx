'use client';

import { useEffect } from 'react';
import { ProjectPathPicker } from '../components/ProjectPathPicker';
import { breadcrumbs } from '../domain/ProjectPaths';
import { useProjectTree } from '../hooks/useProjectTree';
import type { ProjectTreeEntry } from '../types';

type ProjectFolderPickerProps = {
  /** The section's accessible name. */
  label: string;
  hint: string;
  /** Root-relative folder ('.' for the project root). */
  onChoose: (folder: string) => void;
  onClose: () => void;
};

const isDir = (e: ProjectTreeEntry) => e.kind === 'dir';
const noHint = () => '';

/** One folder of the open project at a time with "Use" per folder (the Import Wizard's picker, #600), opened at the
 * project root. The shell's "Change workspace folder" (Line cu6) uses it, so the Cockpit has one in-project picker. */
export function ProjectFolderPickerController({ label, hint, onChoose, onClose }: ProjectFolderPickerProps) {
  const { tree, error, loading, load } = useProjectTree();
  useEffect(() => {
    void load('');
  }, [load]);
  return (
    <ProjectPathPicker
      label={label}
      hint={hint}
      tree={tree}
      crumbs={breadcrumbs(tree?.path ?? '')}
      expects="dir"
      loading={loading}
      error={error}
      canChooseEntry={isDir}
      hintFor={noHint}
      onOpen={(p) => void load(p)}
      onChoose={onChoose}
      onClose={onClose}
    />
  );
}
