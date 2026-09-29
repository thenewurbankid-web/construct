// Accessible dropdown menu, wrapping Radix Primitives' DropdownMenu (#441). Radix owns arrow-key roving
// focus, Home/End, typeahead, Esc-to-close, return-focus-to-trigger and outside-click-to-close; this file
// is the ONLY place in the app that imports `@radix-ui/react-dropdown-menu` — every feature imports the
// wrapper below instead, so the library underneath (Radix today) is swappable by editing this one file.
//
// This is for widgets that actually promise `role="menu"` (a list of commands reached by arrow keys),
// like the trail's folded-steps "..." button. It is NOT for every popover: `UserMenu`/`ProjectSwitcher`
// are deliberately disclosures (see UserMenu.tsx's docstring) and keep the shared `useDismissable`
// contract (docs/design/popovers.md, #298) instead — `role="menu"` would be the wrong contract there
// (a login-status header is not a valid `menuitem`/`group`/`separator` child).
import * as RadixMenu from '@radix-ui/react-dropdown-menu';

export function Menu({ open, onOpenChange, children }) {
  return <RadixMenu.Root open={open} onOpenChange={onOpenChange}>{children}</RadixMenu.Root>;
}

export const MenuTrigger = RadixMenu.Trigger;

// `align`/`sideOffset` forwarded so callers can match their existing popover placement; className carries
// our tokens, Radix contributes only behavior and positioning math.
export function MenuContent({ className = '', align = 'start', sideOffset = 4, children, ...rest }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content className={className} align={align} sideOffset={sideOffset} {...rest}>
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function MenuItem({ className = '', ...rest }) {
  return <RadixMenu.Item className={className} {...rest} />;
}
