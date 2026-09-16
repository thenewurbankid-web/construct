/** Storybook config for ui/client (#45). Kept deliberately minimal: this
 * project has no TypeScript anywhere else (plain .jsx/.js throughout), so
 * this stays plain JS too rather than pulling in a TS toolchain just for
 * Storybook. Framework is @storybook/react-vite, which reuses this app's
 * own Vite/React setup (JSX, aliasing, etc.) rather than a separate
 * webpack pipeline. Only @storybook/addon-docs is kept beyond the
 * framework itself — the default `storybook init` also offered
 * @storybook/addon-vitest (browser-mode Vitest + its own Playwright
 * install) and @storybook/addon-a11y wired through it, @chromatic-com/
 * storybook, and @storybook/addon-mcp; all four were removed as
 * unnecessary scope for "install and configure Storybook" — this repo
 * already has a real, separate Playwright e2e suite (ui/e2e) that is the
 * actual regression guard, and pulling in a second, addon-driven
 * browser-test stack here would just duplicate that with more
 * dependencies and a slower install, not add real coverage. */
const config = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
