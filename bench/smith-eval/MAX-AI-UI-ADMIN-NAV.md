# Smith chain on max-ai-ui admin-navigation

App: `src/features/admin-navigation` of max-ai-ui (read-only: parsed and read, nothing written or run). Smith: atomic-codemod a9191a5 (canonical mode, raw TS/TSX), smith f70eecf. Gloss: qwen2.5-coder:1.5b (packages/engine/lsp/gloss.mjs). Facts: packages/engine/lsp/facts.mjs compileFacts over the feature folder (max-ai-ui is not a Line project, so no moduleScope: the scope is the 7 non-test files of the folder, read with the TS language service against the app's tsconfig). Gate: packages/engine/lsp/gate.mjs atomicGate, layer from the folder (domain, hooks, controllers, components, pages).

## admin-navigation/components/AdminNavigation

`src/features/admin-navigation/components/AdminNavigation.tsx`, component

Code: 160 lines.

**Smith** (2 sentences, 3810 characters, 0 gaps):

> Admin navigation using {children, crumbs, display name, initials, sections, selected item id, is side nav collapsed, content ref, on nav item click, on toggle side nav, onLogout} works in 1 step. It returns shows a <PageLayoutTopBar> with header as a <TopbarWithRightNav> with left slot as a group containing crumbs map a <React.Fragment> with key as crumb's key containing a <Button> with variant as… (3810 characters)

**Gloss** (kept):

> This code handles the navigation for an admin panel, displaying a top bar with breadcrumbs, a profile menu, and a side navigation. It updates the side navigation based on user interactions and provides logout functionality.

**Facts** (1583 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- THE TARGET admin-navigation/components/AdminNavigation (src/features/admin-navigation/components/AdminNavigation.tsx): component; `function AdminNavigation({ children, crumbs, displayName, initials, sections, selectedItemId, isSideNavCollapsed, contentRef, onNavItemClick, onToggleSideNav, …`; renders <PageLayoutTopBar header={<TopbarWithRightNav …>}>. [quickInfo; Smith]
- admin-navigation/controllers/AdminNavigationInner (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationInner({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigation>; uses AdminNavigation and useAdminNavigation. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigationController (controller), stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain), useAdminNavigation (hook) and AdminNavigationLayout (page). [ls]
- Type AdminNavigationProps (src/features/admin-navigation/types.ts): `type AdminNavigationProps = AdminNavigationViewData & { children: React.ReactNode; }`. [quickInfo]
- Outside the feature, from @subframe/core: SubframeCore: `import SubframeCore`. [quickInfo]
- Outside the feature, from @subframe/core: FeatherChevronDown: `const SvgFeatherChevronDown: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & React.Re…`; FeatherChevronRight: `const SvgFeatherChevronRight: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & React.R…`; FeatherLogOut: `const SvgFeatherLogOut: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & React.RefAttr…`; FeatherPanelLeft: `const SvgFeatherPanelLeft: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & React.RefA…`. [quickInfo]
- Outside the feature, from next/image: Image: `const Image: React.ForwardRefExoticComponent<Omit<React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageEl…`. [quickInfo]
- Outside the feature, from react: React: `namespace React`. [quickInfo]
- Outside the feature, from @/ui-v2/components/Avatar: Avatar: `const Avatar: ForwardRefExoticComponent<AvatarRootProps & RefAttributes<HTMLDivElement>>`. [quickInfo]
- Outside the feature, from @/ui-v2/components/Button: Button: `const Button: ForwardRefExoticComponent<ButtonRootProps & RefAttributes<HTMLButtonElement>>`. [quickInfo]
- Outside the feature, from @/ui-v2/components/DropdownMenu: DropdownMenu: `const DropdownMenu: ForwardRefExoticComponent<DropdownMenuRootProps & RefAttributes<HTMLDivElement>> & { Drop…`. [quickInfo]
- Outside the feature, from @/ui-v2/components/IconButton: IconButton: `const IconButton: ForwardRefExoticComponent<IconButtonRootProps & RefAttributes<HTMLButtonElement>>`. [quickInfo]
- Outside the feature, from @/ui-v2/components/PageLayoutTopBar: PageLayoutTopBar: `const PageLayoutTopBar: ForwardRefExoticComponent<PageLayoutTopBarRootProps & RefAttributes<HTMLDivElement>>`. [quickInfo]
- Outside the feature, from @/ui-v2/components/SideNav: SideNav: `const SideNav: ForwardRefExoticComponent<SideNavRootProps & RefAttributes<HTMLElement>> & { NavItem: ForwardR…`. [quickInfo]
- Outside the feature, from @/ui-v2/components/TopbarWithRightNav: TopbarWithRightNav: `const TopbarWithRightNav: ForwardRefExoticComponent<TopbarWithRightNavRootProps & RefAttributes<HTMLElement>>…`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: import type { AdminNavigationProps } from "../types"; import * as SubframeCore from "@subframe/core"; import { FeatherBuilding2, FeatherChevronDown, FeatherChevronRight, FeatherDatabaseZap, FeatherLogOut, FeatherPanelLeft, } from "@subframe/core"; import Image from "next/image"; import React from "react"; import { Avatar } from "@/ui-v2/components/Avatar"; import { Button } from "@/ui-v2/components/Button"; import { DropdownMenu } from "@/ui-v2/components/DropdownMenu"; import { IconButton } from "@/ui-v2/components/IconButton"; import { PageLayoutTopBar } from "@/ui-v2/components/PageLayoutTopBar"; import { SideNav } from "@/ui-v2/components/SideNav"; import { TopbarWithRightNav } from "@/ui-v2/components/TopbarWithRightNav"; [src/features/admin-navigation/components/AdminNavigation.tsx]

Current step: Fill admin-navigation/components/AdminNavigation: Renders the admin console frame — collapsible side nav, topbar with breadcrumbs and profile menu — around page content. Mirrors the CPO frame. Write it in src/features/admin-navigation/components/AdminNavigation.tsx with plan_add line.setCode (the whole file, contentHash 0df49db8804db6d4).
```

**Gate**: fail (connections)

- ok   stub: nothing unused, it returns what it declares
- ok   complexity: cyclomatic 3/20 (component)
- FAIL connections: reads imported React, SubframeCore, DropdownMenu, SideNav as data, not through a function
- ok   smith: 1 sentence(s): It returns shows a <PageLayoutTopBar> with header as a <TopbarWithRightNav> with

## admin-navigation/controllers/AdminNavigationInner

`src/features/admin-navigation/controllers/AdminNavigationController.tsx`, controller

```tsx
function AdminNavigationInner({ children }: AdminNavigationLayoutProps) {
  const viewData = useAdminNavigation();
  return <AdminNavigation {...viewData}>{children}</AdminNavigation>;
}
```

**Smith** (3 sentences, 183 characters, 0 gaps):

> Admin navigation inner using {children} works in 2 steps. Let view data be use admin navigation. It returns shows a <AdminNavigation> with everything in view data containing children.

**Gloss** (kept):

> This code snippet is designed to render an `AdminNavigation` component based on the data provided. It takes the `children` prop, which presumably contains the data to be displayed, and uses it to render the `AdminNavigation` component with all the data included.

**Facts** (858 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/components/AdminNavigation (src/features/admin-navigation/components/AdminNavigation.tsx): component; `function AdminNavigation({ children, crumbs, displayName, initials, sections, selectedItemId, isSideNavCollapsed, contentRef, onNavItemClick, onToggleSideNav, …`; renders <PageLayoutTopBar header={<TopbarWithRightNav …>}>. [quickInfo; Smith]
- THE TARGET admin-navigation/controllers/AdminNavigationInner (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationInner({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigation>; uses AdminNavigation and useAdminNavigation. [quickInfo; Smith]
- admin-navigation/controllers/AdminNavigationController (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationController({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <BreadcrumbProvider>; uses AdminNavigationInner. [quickInfo; Smith]
- admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain) and AdminNavigationLayout (page). [ls]
- Type AdminNavigationLayoutProps (src/features/admin-navigation/types.ts): `type AdminNavigationLayoutProps = { children: React.ReactNode; }`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: import type { AdminNavigationLayoutProps } from "../types"; import AdminNavigation from "../components/AdminNavigation"; import { useAdminNavigation } from "../hooks/useAdminNavigation"; [src/features/admin-navigation/controllers/AdminNavigationController.tsx]

Current step: Fill admin-navigation/controllers/AdminNavigationInner: Wires the admin-navigation hook to its component; must render inside BreadcrumbProvider. Write it in src/features/admin-navigation/controllers/AdminNavigationController.tsx with plan_add line.setCode (the whole file, contentHash 45d2013dc14ab039).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   complexity: cyclomatic 1/10 (controller)
- ok   connections: only through functions
- ok   smith: 2 sentence(s): Let view data be use admin navigation.

## admin-navigation/controllers/AdminNavigationController

`src/features/admin-navigation/controllers/AdminNavigationController.tsx`, controller

```tsx
function AdminNavigationController({ children }: AdminNavigationLayoutProps) {
  return (
    <BreadcrumbProvider>
      <AdminNavigationInner>{children}</AdminNavigationInner>
    </BreadcrumbProvider>
  );
}
```

**Smith** (2 sentences, 158 characters, 0 gaps):

> Admin navigation controller using {children} works in 1 step. It returns shows a <BreadcrumbProvider> containing a <AdminNavigationInner> containing children.

**Gloss** (kept):

> This code snippet is a simple navigation controller for an admin interface. It takes a list of children and returns a breadcrumb provider with an inner navigation component that displays these children.

**Facts** (796 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/controllers/AdminNavigationInner (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationInner({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigation>; uses AdminNavigation and useAdminNavigation. [quickInfo; Smith]
- THE TARGET admin-navigation/controllers/AdminNavigationController (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationController({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <BreadcrumbProvider>; uses AdminNavigationInner. [quickInfo; Smith]
- admin-navigation/pages/AdminNavigationLayout (src/features/admin-navigation/pages/AdminNavigationLayout.tsx): page; `function AdminNavigationLayout({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigationController>; uses AdminNavigationController. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain) and useAdminNavigation (hook). [ls]
- Type AdminNavigationLayoutProps (src/features/admin-navigation/types.ts): `type AdminNavigationLayoutProps = { children: React.ReactNode; }`. [quickInfo]
- Outside the feature, from @/libs/context/BreadcrumbContext: BreadcrumbProvider: `function BreadcrumbProvider({ children }: { children: React.ReactNode; }): React.JSX.Element`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: import type { AdminNavigationLayoutProps } from "../types"; import { BreadcrumbProvider } from "@/libs/context/BreadcrumbContext"; [src/features/admin-navigation/controllers/AdminNavigationController.tsx]

Current step: Fill admin-navigation/controllers/AdminNavigationController: Provides breadcrumb context, then renders the admin console frame. Write it in src/features/admin-navigation/controllers/AdminNavigationController.tsx with plan_add line.setCode (the whole file, contentHash 45d2013dc14ab039).
```

**Gate**: pass, template-exempt from Smith

- ok   stub: nothing unused, it returns what it declares
- ok   complexity: cyclomatic 1/10 (controller)
- ok   connections: only through functions
- ok   smith: template: dumb JSX, checked by DOM render

## admin-navigation/domain/stripLocale

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function stripLocale(pathname: string): string {
  return pathname.replace(LOCALE_PREFIX, "");
}
```

**Smith** (2 sentences, 94 characters, 0 gaps):

> Strip locale using pathname works in 1 step. It returns pathname replace LOCALE_PREFIX and ''.

**Gloss** (kept):

> The code snippet takes a pathname and removes the locale prefix and an empty string, effectively stripping the locale from the path.

**Facts** (486 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- THE TARGET admin-navigation/domain/stripLocale (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function stripLocale(pathname: string): string`. [quickInfo; Smith]
- admin-navigation/domain/isWithinPath (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function isWithinPath(pathname: string | null, href: string): boolean`; uses stripLocale. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain), useAdminNavigation (hook) and AdminNavigationLayout (page). [ls]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/stripLocale: Removes a leading locale segment (e.g. "/en") so paths compare against plain hrefs. Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 1/15 (domain)
- ok   connections: only through functions
- ok   smith: 1 sentence(s): It returns pathname replace LOCALE_PREFIX and ''.

## admin-navigation/domain/isWithinPath

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function isWithinPath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = stripLocale(pathname);
  return path === href || path.startsWith(`${href}/`);
}
```

**Smith** (4 sentences, 194 characters, 0 gaps):

> Is within path using pathname and href works in 3 steps. If not (pathname), return false. Let path be strip locale of pathname. It returns path === href or path starts with text of href and '/'.

**Gloss** (dropped: introduces identifier "URL's" not in Smith's text):

> (rejected) This function checks if a given URL is within the current path. It first checks if the URL's pathname matches the current path.

**Facts** (559 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/domain/stripLocale (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function stripLocale(pathname: string): string`. [quickInfo; Smith]
- THE TARGET admin-navigation/domain/isWithinPath (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function isWithinPath(pathname: string | null, href: string): boolean`; uses stripLocale. [quickInfo; Smith]
- admin-navigation/domain/getSelectedAdminNavItemId (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function getSelectedAdminNavItemId(sections: AdminNavSection[], pathname: string | null): string | null`; uses isWithinPath. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), getAdminNavigation (domain), breadcrumbTestId (domain), isDataLoadsItem (domain), useAdminNavigation (hook) and AdminNavigationLayout (page). [ls]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/isWithinPath: Whether a path is `href` itself or a page beneath it (segment-aware, locale-agnostic). Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 3/15 (domain)
- ok   connections: only through functions
- ok   smith: 3 sentence(s): If not (pathname), return false.

## admin-navigation/domain/getAdminNavigation

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function getAdminNavigation(): AdminNavSection[] {
  return BEROE_ADMIN_NAVIGATION;
}
```

**Smith** (2 sentences, 72 characters, 0 gaps):

> Get admin navigation works in 1 step. It returns BEROE_ADMIN_NAVIGATION.

**Gloss** (dropped: introduces literal "BEROE ADMIN NAVIGATION" not in Smith's text):

> (rejected) The code snippet provides a straightforward way to access the admin navigation, returning the value "BEROE ADMIN NAVIGATION".

**Facts** (549 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- THE TARGET admin-navigation/domain/getAdminNavigation (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function getAdminNavigation(): AdminNavSection[]`. [quickInfo; Smith]
- admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), stripLocale (domain), isWithinPath (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain) and AdminNavigationLayout (page). [ls]
- Type AdminNavSection (src/features/admin-navigation/domain/adminNavigation.ts): `type AdminNavSection = { id: string; label: string; items: AdminNavItem[]; }`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/getAdminNavigation: Returns the Beroe Admin side-nav sections. Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 1/15 (domain)
- ok   connections: only through functions
- ok   smith: 1 sentence(s): It returns BEROE_ADMIN_NAVIGATION.

## admin-navigation/domain/getSelectedAdminNavItemId

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function getSelectedAdminNavItemId(sections: AdminNavSection[], pathname: string | null): string | null {
  const matches = sections
    .flatMap(section => section.items)
    .flatMap(item => (item.href && isWithinPath(pathname, item.href) ? [{ id: item.id, href: item.href }] : []));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).id;
}
```

**Smith** (4 sentences, 450 characters, 0 gaps):

> Get selected admin nav item id using sections and pathname works in 3 steps. Let matches be sections flat map section's items flat map if item's href and is within path of pathname and item's href, return a list of an object with id as item's id and href as item's href, then return an empty list. If matches's length === 0, return nothing. It returns matches reduce if item's href's length > best's … (450 characters)

**Gloss** (kept):

> This function retrieves the ID of the selected admin navigation item based on the current section and pathname. It first flattens the sections and items, then filters the items to find those whose href matches the pathname and is within the path.

**Facts** (663 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/domain/isWithinPath (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function isWithinPath(pathname: string | null, href: string): boolean`; uses stripLocale. [quickInfo; Smith]
- THE TARGET admin-navigation/domain/getSelectedAdminNavItemId (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function getSelectedAdminNavItemId(sections: AdminNavSection[], pathname: string | null): string | null`; uses isWithinPath. [quickInfo; Smith]
- admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), stripLocale (domain), getAdminNavigation (domain), breadcrumbTestId (domain), isDataLoadsItem (domain) and AdminNavigationLayout (page). [ls]
- Type AdminNavSection (src/features/admin-navigation/domain/adminNavigation.ts): `type AdminNavSection = { id: string; label: string; items: AdminNavItem[]; }`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/getSelectedAdminNavItemId: Id of the page link the path belongs to (the Data Loads entry is never selected) — the most specific match wins; null when none match. Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 2/15 (domain)
- ok   connections: only through functions
- ok   smith: 3 sentence(s): Let matches be sections flat map section's items flat map if item's href and is 

## admin-navigation/domain/breadcrumbTestId

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function breadcrumbTestId(label: string): string {
  return `btn-breadcrumb-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
```

**Smith** (2 sentences, 151 characters, 0 gaps):

> Breadcrumb test id using label works in 1 step. It returns text of 'btn-breadcrumb-' and label to lower case replace the pattern /[^a-z0-9]+/g and '-'.

**Gloss** (kept):

> The code snippet finds a breadcrumb button by its label, converts the text to lowercase, removes any non-alphanumeric characters, and replaces the hyphens with underscores.

**Facts** (499 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- THE TARGET admin-navigation/domain/breadcrumbTestId (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function breadcrumbTestId(label: string): string`. [quickInfo; Smith]
- admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), isDataLoadsItem (domain) and AdminNavigationLayout (page). [ls]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/breadcrumbTestId: data-testid for a breadcrumb crumb, derived from its label. Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 1/15 (domain)
- ok   connections: only through functions
- ok   smith: 1 sentence(s): It returns text of 'btn-breadcrumb-' and label to lower case replace the pattern

## admin-navigation/domain/isDataLoadsItem

`src/features/admin-navigation/domain/adminNavigation.ts`, domain

```tsx
function isDataLoadsItem(item: AdminNavItem): boolean {
  return item.href === null;
}
```

**Smith** (2 sentences, 82 characters, 0 gaps):

> Is data loads item using item works in 1 step. It returns item's href === nothing.

**Gloss** (dropped: introduces code "isDataLoadsItemUsingItem" not in Smith's text):

> (rejected) The function `isDataLoadsItemUsingItem` checks if an item's `href` property is empty. If it is, the function returns `true`; otherwise, it returns `false`.

**Facts** (569 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- THE TARGET admin-navigation/domain/isDataLoadsItem (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function isDataLoadsItem(item: AdminNavItem): boolean`. [quickInfo; Smith]
- admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), AdminNavigationController (controller), stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain) and AdminNavigationLayout (page). [ls]
- Type AdminNavItem (src/features/admin-navigation/domain/adminNavigation.ts): `type AdminNavItem = { id: string; label: string; icon: AdminNavIconName; href: string | null; testId: string; }`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: (no imports) [src/features/admin-navigation/domain/adminNavigation.ts]

Current step: Fill admin-navigation/domain/isDataLoadsItem: Whether a nav entry opens the external Data Loads app rather than a page. Write it in src/features/admin-navigation/domain/adminNavigation.ts with plan_add line.setCode (the whole file, contentHash 10852af48953b382).
```

**Gate**: pass

- ok   stub: nothing unused, it returns what it declares
- ok   purity: pure (domain layer)
- ok   complexity: cyclomatic 1/15 (domain)
- ok   connections: only through functions
- ok   smith: 1 sentence(s): It returns item's href === nothing.

## admin-navigation/hooks/useAdminNavigation

`src/features/admin-navigation/hooks/useAdminNavigation.ts`, hook

Code: 110 lines.

**Smith** (16 sentences, 2977 characters, 0 gaps):

> Use admin navigation works in 15 steps. Let router be use router. Let pathname be use pathname. Let locale be use locale. Let {displayName, initials} be use user profile. Let trail be use breadcrumb trail. Let [isSideNavCollapsed, toggleSideNavCollapsed] be use side nav collapsed url sync. Let data loads be use data loads launcher of an object with on error as analytics service track event an obje… (2977 characters)

**Gloss** (kept):

> This code snippet is a React component that handles navigation in an admin interface. It uses a router to navigate to different pages, manages a breadcrumb trail, and provides side navigation functionality.

**Facts** (1633 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/controllers/AdminNavigationInner (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationInner({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigation>; uses AdminNavigation and useAdminNavigation. [quickInfo; Smith]
- admin-navigation/domain/getAdminNavigation (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function getAdminNavigation(): AdminNavSection[]`. [quickInfo; Smith]
- admin-navigation/domain/getSelectedAdminNavItemId (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function getSelectedAdminNavItemId(sections: AdminNavSection[], pathname: string | null): string | null`; uses isWithinPath. [quickInfo; Smith]
- admin-navigation/domain/breadcrumbTestId (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function breadcrumbTestId(label: string): string`. [quickInfo; Smith]
- admin-navigation/domain/isDataLoadsItem (src/features/admin-navigation/domain/adminNavigation.ts): domain; `function isDataLoadsItem(item: AdminNavItem): boolean`. [quickInfo; Smith]
- THE TARGET admin-navigation/hooks/useAdminNavigation (src/features/admin-navigation/hooks/useAdminNavigation.ts): hook; `function useAdminNavigation(): AdminNavigationViewData`; uses getAdminNavigation, getSelectedAdminNavItemId, breadcrumbTestId and isDataLoadsItem. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationController (controller), stripLocale (domain), isWithinPath (domain) and AdminNavigationLayout (page). [ls]
- Type AdminNavItem (src/features/admin-navigation/domain/adminNavigation.ts): `type AdminNavItem = { id: string; label: string; icon: AdminNavIconName; href: string | null; testId: string; }`. [quickInfo]
- Type AdminBreadcrumbCrumb (src/features/admin-navigation/types.ts): `type AdminBreadcrumbCrumb = { key: string; label: string; icon?: React.ReactNode; variant: "ghost" | "white"; testId: string; onClick: () => void; }`. [quickInfo]
- Type AdminNavigationViewData (src/features/admin-navigation/types.ts): `type AdminNavigationViewData = { crumbs: AdminBreadcrumbCrumb[]; displayName: string; initials: string; sections: AdminNavSection[]; selectedItemId: string | null; isSideNavCollapsed: boolean; contentRef: React.RefObject<HTMLDivElement | null>; onNavItemClick: (item: AdminNavItem) => void; onToggleSideNav: () => void; onLogout: () => void; }`. [quickInfo]
- Outside the feature, from next-intl: useLocale: `function useLocale(): Locale`. [quickInfo]
- Outside the feature, from next/navigation: usePathname: `function usePathname(): string`; useRouter: `function useRouter(): AppRouterInstance`. [quickInfo]
- Outside the feature, from react: React: `namespace React`. [quickInfo]
- Outside the feature, from @/hooks/v2/common/useDataLoadsLauncher: useDataLoadsLauncher: `function useDataLoadsLauncher({ onError }?: DataLoadsLauncherOptions): DataLoadsLauncher`. [quickInfo]
- Outside the feature, from @/hooks/v2/common/useSideNavCollapsedUrlSync: useSideNavCollapsedUrlSync: `function useSideNavCollapsedUrlSync(): [boolean, () => void]`. [quickInfo]
- Outside the feature, from @/hooks/v2/common/useUserProfile: useUserProfile: `function useUserProfile(): UserProfile`. [quickInfo]
- Outside the feature, from @/libs/context/BreadcrumbContext: useBreadcrumbTrail: `function useBreadcrumbTrail(): BreadcrumbItem[]`. [quickInfo]
- Outside the feature, from @/libs/matomo: analyticsService: `const analyticsService: MatomoAnalyticsService`; matomo: `const matomo: Matomo`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: import type { AdminNavItem } from "../domain/adminNavigation"; import type { AdminBreadcrumbCrumb, AdminNavigationViewData } from "../types"; import { useLocale } from "next-intl"; import { usePathname, useRouter } from "next/navigation"; import React from "react"; import { useDataLoadsLauncher } from "@/hooks/v2/common/useDataLoadsLauncher"; import { useSideNavCollapsedUrlSync } from "@/hooks/v2/common/useSideNavCollapsedUrlSync"; import { useUserProfile } from "@/hooks/v2/common/useUserProfile"; import { useBreadcrumbTrail } from "@/libs/context/BreadcrumbContext"; import { analyticsService, matomo } from "@/libs/matomo"; import { breadcrumbTestId, getAdminNavigation, getSelectedAdminNavItemId, isDataLoadsItem } from "../domain/adminNavigation"; [src/features/admin-navigation/hooks/useAdminNavigation.ts]

Current step: Fill admin-navigation/hooks/useAdminNavigation: Exposes the admin console frame's state — side nav, breadcrumbs, collapse and profile — to its component. Write it in src/features/admin-navigation/hooks/useAdminNavigation.ts with plan_add line.setCode (the whole file, contentHash c4d921c9a0a91af3).
```

**Gate**: fail (connections)

- ok   stub: nothing unused, it returns what it declares
- ok   complexity: cyclomatic 1/10 (hook)
- FAIL connections: reads imported matomo as data, not through a function
- ok   smith: 15 sentence(s): Let router be use router.

## admin-navigation/pages/AdminNavigationLayout

`src/features/admin-navigation/pages/AdminNavigationLayout.tsx`, page

```tsx
function AdminNavigationLayout({ children }: AdminNavigationLayoutProps) {
  return <AdminNavigationController>{children}</AdminNavigationController>;
}
```

**Smith** (2 sentences, 125 characters, 0 gaps):

> Admin navigation layout using {children} works in 1 step. It returns shows a <AdminNavigationController> containing children.

**Gloss** (kept):

> This code snippet defines a layout for an admin navigation system. It takes a set of children components and renders them within an `<AdminNavigationController ` component.

**Facts** (636 tokens):

```
Facts so far (each with where it comes from):
- Scope: feature admin-navigation = the folder src/features/admin-navigation (7 files, tests left out; not a Line project, so no moduleScope: read with the TS language service); its public surface is src/features/admin-navigation/index.ts exporting AdminNavigationLayout. [ls; quickInfo]
- admin-navigation/controllers/AdminNavigationController (src/features/admin-navigation/controllers/AdminNavigationController.tsx): controller; `function AdminNavigationController({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <BreadcrumbProvider>; uses AdminNavigationInner. [quickInfo; Smith]
- THE TARGET admin-navigation/pages/AdminNavigationLayout (src/features/admin-navigation/pages/AdminNavigationLayout.tsx): page; `function AdminNavigationLayout({ children }: AdminNavigationLayoutProps): React.JSX.Element`; renders <AdminNavigationController>; uses AdminNavigationController. [quickInfo; Smith]
- Also in the feature (not used by or using the target): AdminNavigation (component), AdminNavigationInner (controller), stripLocale (domain), isWithinPath (domain), getAdminNavigation (domain), getSelectedAdminNavItemId (domain), breadcrumbTestId (domain), isDataLoadsItem (domain) and useAdminNavigation (hook). [ls]
- Type AdminNavigationLayoutProps (src/features/admin-navigation/types.ts): `type AdminNavigationLayoutProps = { children: React.ReactNode; }`. [quickInfo]
- Nothing the target names is missing: its imports resolve and its stub check is clean. [quickInfo; stubs]
- Use exactly: import type { AdminNavigationLayoutProps } from "../types"; import AdminNavigationController from "../controllers/AdminNavigationController"; [src/features/admin-navigation/pages/AdminNavigationLayout.tsx]

Current step: Fill admin-navigation/pages/AdminNavigationLayout: Route-group layout for the v2 Beroe Admin console. Write it in src/features/admin-navigation/pages/AdminNavigationLayout.tsx with plan_add line.setCode (the whole file, contentHash 27ca060254b38492).
```

**Gate**: pass, template-exempt from Smith

- ok   stub: nothing unused, it returns what it declares
- ok   complexity: cyclomatic 1/10 (page)
- ok   connections: only through functions
- ok   smith: template: dumb JSX, checked by DOM render

## Summary

| function | layer | Smith sentences | Smith chars | gaps | gloss | facts tokens | gate | failed checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AdminNavigation | component | 2 | 3810 | 0 | kept | 1583 | fail | connections |
| AdminNavigationInner | controller | 3 | 183 | 0 | kept | 858 | pass | - |
| AdminNavigationController | controller | 2 | 158 | 0 | kept | 796 | pass | - |
| stripLocale | domain | 2 | 94 | 0 | kept | 486 | pass | - |
| isWithinPath | domain | 4 | 194 | 0 | dropped | 559 | pass | - |
| getAdminNavigation | domain | 2 | 72 | 0 | dropped | 549 | pass | - |
| getSelectedAdminNavItemId | domain | 4 | 450 | 0 | kept | 663 | pass | - |
| breadcrumbTestId | domain | 2 | 151 | 0 | kept | 499 | pass | - |
| isDataLoadsItem | domain | 2 | 82 | 0 | dropped | 569 | pass | - |
| useAdminNavigation | hook | 16 | 2977 | 0 | kept | 1633 | fail | connections |
| AdminNavigationLayout | page | 2 | 125 | 0 | kept | 636 | pass | - |
