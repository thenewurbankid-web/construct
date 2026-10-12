// The e-commerce bench starters' files (make-starter.mjs writes them): one Next.js app-router + Tailwind shell and one
// set of base components on Radix UI primitives (MIT), shared by both arms so the only difference is Line.
//   shellFiles(name)        package.json, configs, app/layout.tsx, app/globals.css (no route yet: every page is the builder's)
//   baseComponents()        Button, TextField, Card, Dialog, Select, Checkbox, Toast  (name -> source)
//   basePages()             ListPage, DetailPage, FormPage
//   baseWorkflows()         listDetail, checkout (xstate, the shape of examples/line-sample/library/workflows)
// Headless UI is not used: Radix has a primitive for every base component the MVP needs.
import fs from 'node:fs';

/** Exact versions (each published well before 2026-09). */
export const DEPENDENCIES = Object.freeze({
  next: '14.2.15', react: '18.3.1', 'react-dom': '18.3.1', xstate: '5.18.2',
  '@radix-ui/react-checkbox': '1.1.2', '@radix-ui/react-dialog': '1.1.2', '@radix-ui/react-label': '2.1.0',
  '@radix-ui/react-select': '2.1.2', '@radix-ui/react-slot': '1.1.0', '@radix-ui/react-toast': '1.2.2',
});
export const DEV_DEPENDENCIES = Object.freeze({
  typescript: '5.6.3', '@types/node': '20.16.11', '@types/react': '18.3.11', '@types/react-dom': '18.3.1',
  tailwindcss: '3.4.14', postcss: '8.4.47', autoprefixer: '10.4.20', eslint: '8.57.1', 'eslint-config-next': '14.2.15',
});

/**
 * The app shell (both arms). `importBase` is where app/layout.tsx imports the Toast provider from.
 * @param {string} name package name
 * @param {string} toastImport module specifier of the Toast component, relative to app/
 * @returns {Record<string, string>}
 */
export function shellFiles(name, toastImport) {
  const pkg = {
    name, version: '0.1.0', private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint', tsc: 'tsc --noEmit' },
    dependencies: { ...DEPENDENCIES }, devDependencies: { ...DEV_DEPENDENCIES },
  };
  return {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'next.config.mjs': '/** @type {import(\'next\').NextConfig} */\nconst nextConfig = { reactStrictMode: true };\n\nexport default nextConfig;\n',
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: {
        target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true,
        module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true,
        plugins: [{ name: 'next' }], paths: { '@/*': ['./*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2)}\n`,
    'next-env.d.ts': '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.\n',
    'tailwind.config.ts': "import type { Config } from 'tailwindcss';\n\nconst config: Config = {\n  content: ['./app/**/*.{ts,tsx}', './library/**/*.{ts,tsx}', './features/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n\nexport default config;\n",
    'postcss.config.mjs': 'const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n\nexport default config;\n',
    '.eslintrc.json': '{\n  "extends": "next/core-web-vitals"\n}\n',
    '.gitignore': 'node_modules/\n.next/\nnext-env.d.ts.bak\n*.tsbuildinfo\n',
    'app/globals.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  @apply bg-white text-slate-900 antialiased;\n}\n',
    'app/layout.tsx': `import type { ReactNode } from 'react';\nimport './globals.css';\nimport { ToastProvider } from '${toastImport}';\n\nexport const metadata = { title: 'Shop' };\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body>\n        <ToastProvider>\n          <div className="mx-auto max-w-5xl p-6">{children}</div>\n        </ToastProvider>\n      </body>\n    </html>\n  );\n}\n`,
  };
}

/**
 * The base components, each a complete item. `level` is Line's atom/molecule mark (the plain arm drops it).
 * @param {boolean} line add Line's `@line-level` marks
 * @returns {Record<string, string>} name -> source
 */
export function baseComponents(line) {
  const lv = (l) => (line ? `// @line-level ${l}\n` : '');
  return {
    Button: `${lv('atom')}'use client';\nimport { Slot } from '@radix-ui/react-slot';\nimport type { ButtonHTMLAttributes, ReactNode } from 'react';\n\ntype Variant = 'primary' | 'secondary' | 'ghost';\nconst VARIANTS: Record<Variant, string> = {\n  primary: 'bg-slate-900 text-white hover:bg-slate-700',\n  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',\n  ghost: 'text-slate-700 hover:bg-slate-100',\n};\n\nexport type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {\n  /** The visible text; children win when both are given. */\n  label?: string;\n  children?: ReactNode;\n  variant?: Variant;\n  /** Render the child element (a link, say) with the button's look (Radix Slot). */\n  asChild?: boolean;\n};\n\nexport function Button({ label, children, variant = 'primary', asChild = false, className = '', type = 'button', ...rest }: ButtonProps) {\n  const Comp = asChild ? Slot : 'button';\n  return (\n    <Comp type={asChild ? undefined : type} className={\`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 \${VARIANTS[variant]} \${className}\`} {...rest}>\n      {children ?? label}\n    </Comp>\n  );\n}\n`,
    TextField: `${lv('atom')}'use client';\nimport * as Label from '@radix-ui/react-label';\nimport { useId } from 'react';\nimport type { InputHTMLAttributes } from 'react';\n\nexport type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {\n  label: string;\n  value: string;\n  onChange?: (value: string) => void;\n  /** One sentence shown under the field and announced with it. */\n  error?: string;\n};\n\nexport function TextField({ label, value, onChange, error, type = 'text', id, ...rest }: TextFieldProps) {\n  const auto = useId();\n  const inputId = id ?? auto;\n  const errorId = \`\${inputId}-error\`;\n  return (\n    <div className="flex flex-col gap-1">\n      <Label.Root htmlFor={inputId} className="text-sm font-medium">{label}</Label.Root>\n      <input\n        id={inputId}\n        type={type}\n        value={value}\n        onChange={(e) => onChange?.(e.target.value)}\n        aria-invalid={error ? true : undefined}\n        aria-describedby={error ? errorId : undefined}\n        className="rounded-md border border-slate-300 px-3 py-2 text-sm aria-[invalid=true]:border-red-600"\n        {...rest}\n      />\n      {error ? <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p> : null}\n    </div>\n  );\n}\n`,
    Card: `${lv('molecule')}import type { ReactNode } from 'react';\n\nexport type CardProps = {\n  title: string;\n  /** Small text above the title, e.g. a category. */\n  eyebrow?: string;\n  children?: ReactNode;\n  /** Buttons or links at the bottom of the card. */\n  footer?: ReactNode;\n};\n\nexport function Card({ title, eyebrow, children, footer }: CardProps) {\n  return (\n    <article className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">\n      {eyebrow ? <p className="text-xs uppercase tracking-wide text-slate-500">{eyebrow}</p> : null}\n      <h2 className="text-lg font-semibold">{title}</h2>\n      {children}\n      {footer ? <div className="mt-auto flex gap-2 pt-2">{footer}</div> : null}\n    </article>\n  );\n}\n`,
    Dialog: `${lv('molecule')}'use client';\nimport * as RadixDialog from '@radix-ui/react-dialog';\nimport type { ReactNode } from 'react';\n\nexport type DialogProps = {\n  open?: boolean;\n  onOpenChange?: (open: boolean) => void;\n  /** The element that opens the dialog (optional when \`open\` is controlled). */\n  trigger?: ReactNode;\n  title: string;\n  description?: string;\n  children?: ReactNode;\n};\n\nexport function Dialog({ open, onOpenChange, trigger, title, description, children }: DialogProps) {\n  return (\n    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>\n      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}\n      <RadixDialog.Portal>\n        <RadixDialog.Overlay className="fixed inset-0 bg-black/40" />\n        <RadixDialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg">\n          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>\n          {description ? <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description> : null}\n          <div className="mt-4">{children}</div>\n          <RadixDialog.Close className="absolute right-3 top-3 rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">×</RadixDialog.Close>\n        </RadixDialog.Content>\n      </RadixDialog.Portal>\n    </RadixDialog.Root>\n  );\n}\n`,
    Select: `${lv('atom')}'use client';\nimport * as Label from '@radix-ui/react-label';\nimport * as RadixSelect from '@radix-ui/react-select';\nimport { useId } from 'react';\n\nexport type SelectOption = { value: string; label: string };\nexport type SelectProps = {\n  label: string;\n  value: string;\n  onValueChange: (value: string) => void;\n  options: SelectOption[];\n  placeholder?: string;\n};\n\n/** A labelled select (Radix Select): the trigger is a combobox named by its label; each option is an option role. */\nexport function Select({ label, value, onValueChange, options, placeholder }: SelectProps) {\n  const id = useId();\n  return (\n    <div className="flex flex-col gap-1">\n      <Label.Root id={\`\${id}-label\`} htmlFor={id} className="text-sm font-medium">{label}</Label.Root>\n      <RadixSelect.Root value={value} onValueChange={onValueChange}>\n        <RadixSelect.Trigger id={id} aria-labelledby={\`\${id}-label\`} className="inline-flex min-w-48 items-center justify-between rounded-md border border-slate-300 px-3 py-2 text-sm">\n          <RadixSelect.Value placeholder={placeholder} />\n          <RadixSelect.Icon>▾</RadixSelect.Icon>\n        </RadixSelect.Trigger>\n        <RadixSelect.Portal>\n          <RadixSelect.Content position="popper" className="rounded-md border border-slate-200 bg-white shadow-md">\n            <RadixSelect.Viewport className="p-1">\n              {options.map((o) => (\n                <RadixSelect.Item key={o.value} value={o.value} className="cursor-pointer rounded px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100">\n                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>\n                </RadixSelect.Item>\n              ))}\n            </RadixSelect.Viewport>\n          </RadixSelect.Content>\n        </RadixSelect.Portal>\n      </RadixSelect.Root>\n    </div>\n  );\n}\n`,
    Checkbox: `${lv('atom')}'use client';\nimport * as RadixCheckbox from '@radix-ui/react-checkbox';\nimport * as Label from '@radix-ui/react-label';\nimport { useId } from 'react';\n\nexport type CheckboxProps = {\n  label: string;\n  checked: boolean;\n  onCheckedChange: (checked: boolean) => void;\n  error?: string;\n};\n\n/** A labelled checkbox (Radix Checkbox: role checkbox, named by its label). */\nexport function Checkbox({ label, checked, onCheckedChange, error }: CheckboxProps) {\n  const id = useId();\n  return (\n    <div className="flex flex-col gap-1">\n      <div className="flex items-center gap-2">\n        <RadixCheckbox.Root id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} aria-invalid={error ? true : undefined} className="flex h-5 w-5 items-center justify-center rounded border border-slate-400 data-[state=checked]:bg-slate-900">\n          <RadixCheckbox.Indicator className="text-xs text-white">✓</RadixCheckbox.Indicator>\n        </RadixCheckbox.Root>\n        <Label.Root htmlFor={id} className="text-sm">{label}</Label.Root>\n      </div>\n      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}\n    </div>\n  );\n}\n`,
    Toast: `${lv('molecule')}'use client';\nimport * as RadixToast from '@radix-ui/react-toast';\nimport { createContext, useCallback, useContext, useState } from 'react';\nimport type { ReactNode } from 'react';\n\ntype Note = { id: number; title: string; description?: string };\nconst ToastContext = createContext<(title: string, description?: string) => void>(() => {});\n\n/** Wrap the app once (app/layout.tsx); call useToast() anywhere below it to show a short status message. */\nexport function ToastProvider({ children }: { children: ReactNode }) {\n  const [notes, setNotes] = useState<Note[]>([]);\n  const show = useCallback((title: string, description?: string) => {\n    setNotes((n) => [...n, { id: Date.now() + Math.random(), title, description }]);\n  }, []);\n  return (\n    <ToastContext.Provider value={show}>\n      <RadixToast.Provider swipeDirection="right" duration={4000}>\n        {children}\n        {notes.map((n) => (\n          <RadixToast.Root key={n.id} onOpenChange={(open) => { if (!open) setNotes((all) => all.filter((x) => x.id !== n.id)); }} className="rounded-md border border-slate-200 bg-white p-3 shadow-md">\n            <RadixToast.Title className="text-sm font-semibold">{n.title}</RadixToast.Title>\n            {n.description ? <RadixToast.Description className="text-sm text-slate-600">{n.description}</RadixToast.Description> : null}\n          </RadixToast.Root>\n        ))}\n        <RadixToast.Viewport className="fixed bottom-4 right-4 flex w-80 flex-col gap-2" />\n      </RadixToast.Provider>\n    </ToastContext.Provider>\n  );\n}\n\nexport function useToast() {\n  return useContext(ToastContext);\n}\n`,
  };
}

/**
 * The base pages (complete library pages). `componentsFrom` is the import path of the components folder from a page.
 * @param {string} componentsFrom
 * @returns {Record<string, string>}
 */
export function basePages(componentsFrom) {
  return {
    ListPage: `import type { ReactNode } from 'react';\n\nexport type ListPageProps = {\n  title: string;\n  /** Filters and search above the list. */\n  toolbar?: ReactNode;\n  /** The items, laid out as a grid. */\n  children?: ReactNode;\n  /** Shown instead of the grid when there is nothing to list. */\n  empty?: ReactNode;\n};\n\nexport function ListPage({ title, toolbar, children, empty }: ListPageProps) {\n  return (\n    <main className="flex flex-col gap-4">\n      <h1 className="text-2xl font-bold">{title}</h1>\n      {toolbar ? <div className="flex flex-wrap items-end gap-4">{toolbar}</div> : null}\n      {children ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div> : empty}\n    </main>\n  );\n}\n`,
    DetailPage: `import type { ReactNode } from 'react';\n\nexport type DetailPageProps = {\n  title: string;\n  /** A link back, shown above the title. */\n  back?: ReactNode;\n  children?: ReactNode;\n  /** Actions beside the content (price, add to cart). */\n  aside?: ReactNode;\n};\n\nexport function DetailPage({ title, back, children, aside }: DetailPageProps) {\n  return (\n    <main className="flex flex-col gap-4">\n      {back}\n      <h1 className="text-2xl font-bold">{title}</h1>\n      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">\n        <section className="flex flex-col gap-3">{children}</section>\n        {aside ? <aside className="flex flex-col gap-3">{aside}</aside> : null}\n      </div>\n    </main>\n  );\n}\n`,
    FormPage: `'use client';\nimport type { FormEvent, ReactNode } from 'react';\nimport { Button } from '${componentsFrom}/Button';\n\nexport type FormPageProps = {\n  title: string;\n  /** Called with the submit event already prevented. */\n  onSubmit: () => void;\n  submitLabel: string;\n  children?: ReactNode;\n  /** A summary shown beside the form (an order total, say). */\n  aside?: ReactNode;\n};\n\nexport function FormPage({ title, onSubmit, submitLabel, children, aside }: FormPageProps) {\n  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };\n  return (\n    <main className="flex flex-col gap-4">\n      <h1 className="text-2xl font-bold">{title}</h1>\n      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">\n        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={title}>\n          {children}\n          <Button type="submit" label={submitLabel} />\n        </form>\n        {aside ? <aside className="flex flex-col gap-3">{aside}</aside> : null}\n      </div>\n    </main>\n  );\n}\n`,
  };
}

/** The base workflows (xstate, like examples/line-sample/library/workflows). */
export function baseWorkflows() {
  const head = "import { setup } from 'xstate';\n\n";
  const actions = "setup({\n  actions: {\n    callService: (_: unknown, _params: { service: string }) => {},\n    setPartState: (_: unknown, _params: { part: string; state: string }) => {},\n  },\n})";
  return {
    listDetail: `// List then detail: a page lists items; opening one shows it on a detail page; Back returns to the list.\n${head}/** The pages this workflow needs: a feature fills each role with one of its own pages. */\nexport const roles = {\n  list: 'The page that lists the items',\n  detail: 'The page that shows one item',\n};\n\nexport const listDetail = ${actions}.createMachine({\n  id: 'listDetail',\n  initial: 'list',\n  states: {\n    list: { on: { OPEN: 'detail' } },\n    detail: { on: { BACK: 'list' } },\n  },\n});\n`,
    checkout: `// Checkout: review the cart, fill in the details, then the order is confirmed.\n${head}/** The pages this workflow needs: a feature fills each role with one of its own pages. */\nexport const roles = {\n  cart: 'The page that shows what will be bought',\n  details: 'The page with the checkout form',\n  confirmation: 'The page that confirms the order',\n};\n\nexport const checkout = ${actions}.createMachine({\n  id: 'checkout',\n  initial: 'cart',\n  states: {\n    cart: { on: { CHECKOUT: 'details' } },\n    details: { on: { PLACE_ORDER: 'confirmation', BACK: 'cart' } },\n    confirmation: { type: 'final' },\n  },\n});\n`,
  };
}

/** The 12 products in 3 categories (bench/ecommerce/fixtures/products.json). */
export function productsJson() {
  return fs.readFileSync(new URL('./fixtures/products.json', import.meta.url), 'utf8');
}
