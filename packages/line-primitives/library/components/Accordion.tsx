// @line-level molecule
'use client';
import { Accordion as RadixAccordion } from 'radix-ui';
import type { ReactNode } from 'react';

export type AccordionItem = { value: string; title: string; content: ReactNode; disabled?: boolean };
export type AccordionProps = {
  items: AccordionItem[];
  /** The open sections. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Several sections can be open at once. */
  multiple?: boolean;
  variant?: 'plain' | 'boxed';
};

/** Sections whose bodies expand and collapse (Radix Accordion: header buttons with aria-expanded, arrow keys between headers). */
export function Accordion({ items, value, defaultValue, onValueChange, multiple = false, variant = 'plain' }: AccordionProps) {
  const body = items.map((item) => (
    <RadixAccordion.Item key={item.value} value={item.value} disabled={item.disabled} className="border-b border-slate-200">
      <RadixAccordion.Header className="m-0">
        <RadixAccordion.Trigger className="group flex w-full items-center justify-between py-3 text-left text-sm font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50">
          {item.title}
          <span aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-180">▾</span>
        </RadixAccordion.Trigger>
      </RadixAccordion.Header>
      <RadixAccordion.Content className="pb-3 text-sm text-slate-700">{item.content}</RadixAccordion.Content>
    </RadixAccordion.Item>
  ));
  const look = variant === 'boxed' ? 'rounded-md border border-slate-200 px-4' : '';
  if (multiple) {
    return <RadixAccordion.Root type="multiple" value={value} defaultValue={defaultValue} onValueChange={onValueChange} data-variant={variant} className={look}>{body}</RadixAccordion.Root>;
  }
  return (
    <RadixAccordion.Root
      type="single"
      collapsible
      value={value?.[0] ?? (value ? '' : undefined)}
      defaultValue={defaultValue?.[0]}
      onValueChange={(v) => onValueChange?.(v ? [v] : [])}
      data-variant={variant}
      className={look}
    >
      {body}
    </RadixAccordion.Root>
  );
}
