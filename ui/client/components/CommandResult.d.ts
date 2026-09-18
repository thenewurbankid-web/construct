import type { ReactNode } from 'react';

type CommandResultData = {
  ok: boolean;
  output?: string[];
  attribution?: { tool: string; llm: string } | null;
  durationSeconds?: number;
  error?: string;
} | null;

export declare function CommandResult(props: { result: CommandResultData }): ReactNode;
