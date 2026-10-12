// @line-level molecule
'use client';
import { DropdownMenu } from 'radix-ui';

export type MenuItem = { id: string; label: string; disabled?: boolean; danger?: boolean };
export type MenuProps = {
  /** The trigger text. */
  label: string;
  items: MenuItem[];
  /** An item was chosen (its id). */
  onSelect?: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: 'sm' | 'md';
};

/** A list of actions opened from a button (Radix DropdownMenu: role="menu", arrow keys, type-ahead). */
export function Menu({ label, items, onSelect, open, onOpenChange, size = 'md' }: MenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger data-size={size} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 data-[state=open]:bg-slate-100">
        {label}
        <span aria-hidden="true">▾</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={4} className="z-50 min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-md">
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              disabled={item.disabled}
              onSelect={() => onSelect?.(item.id)}
              data-danger={item.danger ? '' : undefined}
              className="flex cursor-pointer items-center rounded px-3 py-1.5 text-sm text-slate-900 outline-none data-[danger]:text-red-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100"
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
