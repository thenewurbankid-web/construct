import type { ShellTab } from '@/features/shell';
import { TestDetail } from '../components/TestDetail';
import { TestsBrowser } from '../components/TestsBrowser';
import type { CodeView, GeneratedTest, InlinePart, TestSelection, TestsListing, YourTest } from '../types';

export type TestsShellTabsInput = {
  features: string[] | null;
  feature: string;
  data: TestsListing | null;
  selected: TestSelection | null;
  test: GeneratedTest | YourTest | null;
  title: string;
  steps: InlinePart[][];
  code: CodeView;
  onFeature: (feature: string) => void;
  onSelect: (selection: TestSelection) => void;
  onClone: (file: string) => void;
  onEditStep: (file: string, step: number) => void;
  onShowCode: () => void;
  onHideCode: () => void;
  onEditSteps: (file: string) => void;
};

// Presentation-only: the Tests screen's pieces as shell tabs (Browser: Tests, Tools: Test), registered into the
// shell's slot registry by the controller while the screen is mounted.
export function testsShellTabs(i: TestsShellTabsInput): { browser: ShellTab; tools: ShellTab } {
  return {
    browser: {
      id: 'tests',
      title: 'Tests',
      preferred: true,
      badge: i.data ? i.data.generated.length + i.data.yours.length : null,
      render: () => <TestsBrowser features={i.features} feature={i.feature} onFeature={i.onFeature} data={i.data} selected={i.selected} onSelect={i.onSelect} />,
    },
    tools: {
      id: 'test',
      title: 'Test',
      preferred: true,
      render: () => <TestDetail test={i.test} title={i.title} steps={i.steps} code={i.code} onClone={i.onClone} onEditStep={i.onEditStep} onShowCode={i.onShowCode} onHideCode={i.onHideCode} onEditSteps={i.onEditSteps} />,
    },
  };
}
