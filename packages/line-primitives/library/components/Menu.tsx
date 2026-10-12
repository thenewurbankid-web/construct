// @line-level molecule
'use client';
import { DropdownMenu } from 'radix-ui';

/** An action item; give `checked` to make it a checkbox item (menuitemcheckbox). */
export type MenuItem = { id: string; label: string; disabled?: boolean; danger?: boolean; checked?: boolean };
export type MenuProps = {
  /** The trigger text. */
  label: string;
  items: MenuItem[];
  /** An action item was chosen (its id). */
  onSelect?: (id: string) => void;
  /** A checkbox item was toggled. */
  onCheckedChange?: (id: string, checked: boolean) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Escape or an outside click is about to close it; call preventDefault on the event to keep it open. */
  onDismiss?: (event: Event) => void;
  size?: 'sm' | 'md';
};

const ITEM = 'flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm text-slate-900 outline-none data-[danger]:text-red-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100';

/** A list of actions opened from a button (Radix DropdownMenu: role="menu", arrow keys, type-ahead, checkbox items). */
export function Menu({ label, items, onSelect, onCheckedChange, open, onOpenChange, onDismiss, size = 'md' }: MenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger data-size={size} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 data-[state=open]:bg-slate-100">
        {label}
        <span aria-hidden="true">▾</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={4} onEscapeKeyDown={onDismiss} onInteractOutside={onDismiss} className="z-50 min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-md">
          {items.map((item) => <MenuEntry key={item.id} item={item} onSelect={onSelect} onCheckedChange={onCheckedChange} />)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuEntry({ item, onSelect, onCheckedChange }: { item: MenuItem; onSelect?: MenuProps['onSelect']; onCheckedChange?: MenuProps['onCheckedChange'] }) {
  if (item.checked !== undefined) {
    return (
      <DropdownMenu.CheckboxItem checked={item.checked} disabled={item.disabled} onCheckedChange={(v) => onCheckedChange?.(item.id, v === true)} onSelect={(e) => e.preventDefault()} className={ITEM}>
        <span aria-hidden="true" className="w-3"><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></span>
        {item.label}
      </DropdownMenu.CheckboxItem>
    );
  }
  return (
    <DropdownMenu.Item disabled={item.disabled} onSelect={() => onSelect?.(item.id)} data-danger={item.danger ? '' : undefined} className={ITEM}>
      {item.label}
    </DropdownMenu.Item>
  );
}
