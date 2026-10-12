// @line-level molecule
'use client';
import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';

export type TabItem = { value: string; label: string; content: ReactNode; disabled?: boolean };
export type TabsProps = {
  /** Names the tab list. */
  label: string;
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'line' | 'pill';
};

const TRIGGER: Record<'line' | 'pill', string> = {
  line: 'border-b-2 border-transparent data-[state=active]:border-slate-900',
  pill: 'rounded-md data-[state=active]:bg-slate-900 data-[state=active]:text-white',
};

/** Switch between panels of content (Radix Tabs: arrows move and select, Home/End, roving focus). */
export function Tabs({ label, tabs, value, defaultValue, onValueChange, orientation = 'horizontal', variant = 'line' }: TabsProps) {
  return (
    <RadixTabs.Root value={value} defaultValue={defaultValue ?? tabs[0]?.value} onValueChange={onValueChange} orientation={orientation} data-variant={variant} className="flex gap-4 data-[orientation=horizontal]:flex-col">
      <RadixTabs.List aria-label={label} className="flex gap-1 data-[orientation=vertical]:flex-col">
        {tabs.map((t) => (
          <RadixTabs.Trigger key={t.value} value={t.value} disabled={t.disabled} className={`px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:text-slate-900 ${TRIGGER[variant]}`}>
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((t) => (
        <RadixTabs.Content key={t.value} value={t.value} className="text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
