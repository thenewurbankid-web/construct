// #497 -- `construct init` lays down a minimal, runnable project shell for the chosen framework
// (package.json, tsconfig, bundler config, .gitignore, ...) next to the architecture folders, so a
// developer can `npm install && npm run dev` straight after init instead of hand-writing Vite/Next
// boilerplate first. Static template data only: no network, no `npm install`, no shell. An existing
// file is NEVER overwritten (it is reported as skipped), and `construct init --no-scaffold` opts out.
//
// Templates live in TEMPLATES below as data (a path -> object|string map per framework); JSON
// files are given as objects so the output is always valid JSON. `__NAME__` is the only placeholder.
// Versions follow the majors the repo itself uses (ui/client: next ^15, react ^19, typescript ^5).
import fs from 'node:fs';
import path from 'node:path';
import { write } from './fs.mjs';

// xstate: `construct generate workflow` emits XState v5 machines, so a generated project needs it to type-check.
const REACT = { react: '^19.1.0', 'react-dom': '^19.1.0', xstate: '^5.0.0' };
const REACT_TYPES = { '@types/react': '^19', '@types/react-dom': '^19' };

const GITIGNORE = 'node_modules\ndist\n.next\nout\n*.tsbuildinfo\n.env*.local\n.DS_Store\nnpm-debug.log*\n';

const TEMPLATES = {
  'react-spa': {
    'package.json': {
      name: '__NAME__', private: true, version: '0.1.0', type: 'module',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' },
      dependencies: { ...REACT, 'react-router-dom': '^7.0.0' },
      devDependencies: { ...REACT_TYPES, '@vitejs/plugin-react': '^5.0.0', typescript: '^5.9.0', vite: '^7.0.0' },
    },
    'tsconfig.json': {
      compilerOptions: {
        target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
        jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true,
        resolveJsonModule: true, moduleDetection: 'force',
      },
      include: ['src', 'features', 'vite.config.ts'],
    },
    'vite.config.ts': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n",
    'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>__NAME__</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
    '.gitignore': GITIGNORE,
  },
  nextjs: {
    'package.json': {
      name: '__NAME__', private: true, version: '0.1.0',
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: { next: '^15.5.0', ...REACT },
      devDependencies: { ...REACT_TYPES, '@types/node': '^20', typescript: '^5' },
    },
    'tsconfig.json': {
      compilerOptions: {
        target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true,
        noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true,
        isolatedModules: true, jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    },
    'next.config.mjs': "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n",
    // What create-next-app writes; `next dev`/`next build` regenerate it, and it is gitignored there too.
    'next-env.d.ts': '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n',
    // The App Router requires a root layout; without one `next dev` invents app/layout.tsx on first run.
    'app/layout.tsx': "import type { ReactNode } from 'react';\n\nexport const metadata = { title: '__NAME__' };\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang=\"en\">\n      <body>{children}</body>\n    </html>\n  );\n}\n",
    '.gitignore': `${GITIGNORE}next-env.d.ts\n`,
  },
};

/** The frameworks that have a scaffold template. */
export const SCAFFOLD_FRAMEWORKS = Object.keys(TEMPLATES);

/** An npm-valid package name derived from the project directory's name. */
const packageName = (dir) => path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[-._]+|-+$/g, '') || 'construct-app';

/**
 * Write the framework's minimal runnable project shell into `dir`, skipping (never overwriting)
 * any file that already exists. Writes only static files: no network, no npm install.
 *
 * @param {string} dir Target project directory (must exist).
 * @param {string} framework A normalized framework name (`nextjs` | `react-spa`).
 * @returns {{written: string[], skipped: string[]}} Project-relative POSIX paths written / left alone because they already existed.
 *
 * @example
 * scaffoldProject('my-app', 'react-spa'); // => { written: ['package.json', 'tsconfig.json', ...], skipped: [] }
 */
export function scaffoldProject(dir, framework) {
  const files = TEMPLATES[framework] ?? {};
  const name = packageName(dir);
  const written = [];
  const skipped = [];
  for (const [rel, template] of Object.entries(files)) {
    const target = path.join(dir, ...rel.split('/'));
    if (fs.existsSync(target)) {
      skipped.push(rel);
      continue;
    }
    const raw = typeof template === 'string' ? template : `${JSON.stringify(template, null, 2)}\n`;
    write(target, raw.replaceAll('__NAME__', name));
    written.push(rel);
  }
  return { written, skipped };
}
