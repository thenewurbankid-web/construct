// View models the controller hands to the presentation-only components (COMPONENT-003: a component gets props,
// never application logic).
import type { ChooserExit, ChooserSummary, PlanDoc, Status, StepId } from './domain/DebugTypes';

export type DebugStepView = { id: StepId; summary: ChooserSummary; exit: ChooserExit; answered: boolean };

export type ApproveView = { canApprove: boolean; running: boolean; started: boolean; processId: string | null; error: string | null };

export type DebugViewModel = {
  feature: string;
  canStart: boolean;
  read: { status: Status; error: string | null };
  steps: DebugStepView[];
  done: boolean;
  plan: PlanDoc | null;
  compileError: string | null;
  approve: ApproveView;
  verifyPrompt: boolean;
  verifyPassed: boolean;
  iterations: number;
};

export type ChooserCardProps = {
  step: DebugStepView;
  onAnswer: (chooser: StepId, option: string) => void;
};

export type ApproveBarProps = {
  plan: PlanDoc | null;
  compileError: string | null;
  approve: ApproveView;
  onApprove: () => void;
  onOpenProcesses: () => void;
};

export type VerifyPromptProps = {
  visible: boolean;
  passed: boolean;
  iterations: number;
  onResult: (passed: boolean) => void;
};
