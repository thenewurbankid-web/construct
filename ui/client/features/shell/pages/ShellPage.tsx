import type { ReactNode } from 'react';
import { ShellLayout } from '../components/ShellLayout';
import { StatusBar } from '../components/StatusBar';
import { TabHost } from '../components/TabHost';
import { TopBar } from '../components/TopBar';
import type { ShellPageProps, ShellRegion } from '../types';

// Presentation-only composition (PAGE-002..006): wires the slot components
// from props. All state and data come from ShellController.
export function ShellPage(props: ShellPageProps): ReactNode {
  const { tabs, activeTabs, onSelectTab } = props;
  const host = (region: ShellRegion, label: string) => (
    <TabHost label={label} tabs={tabs[region]} activeId={activeTabs[region]} onSelect={(id) => onSelectTab(region, id)} />
  );
  return (
    <ShellLayout
      layout={props.layout}
      limits={props.limits}
      onResize={props.onResize}
      onTogglePane={props.onTogglePane}
      narrow={props.narrow}
      narrowPane={props.narrowPane}
      onNarrowPane={props.onNarrowPane}
      top={
        <TopBar
          modes={props.modes}
          activeModeId={props.activeModeId}
          projectSwitcher={props.projectSwitcher}
          themeToggle={props.themeToggle}
          modelStatus={props.modelStatus}
          runningProcesses={props.runningProcesses}
          layout={props.layout}
          onTogglePane={props.onTogglePane}
          onOpenProcesses={props.onOpenProcesses}
          onOpenPalette={props.onOpenPalette}
        />
      }
      left={host('browser', 'Browser')}
      mid={<main className="main">{props.children}</main>}
      right={host('tools', 'Tools')}
      drawer={host('drawer', 'Drawer')}
      status={<StatusBar layout={props.layout} onTogglePane={props.onTogglePane} shortcuts={props.shortcuts} validateStatus={props.validateStatus} onOpenDiagnostics={props.onOpenDiagnostics} />}
    />
  );
}
