/** Storybook config for ui/client (#45), re-pointed at Next.js after the
 * #70-74 migration off Vite. Framework is @storybook/nextjs, which reuses
 * this app's own Next.js/webpack setup (JSX/TSX, the `@/*` path alias,
 * globals.css) instead of a separate Vite pipeline — same reasoning as
 * before, just swapped for the new framework. Stories now live under
 * components/ and features/*\/components/ (there is no src/ anymore), so
 * the glob below covers both. Only @storybook/addon-docs is kept beyond
 * the framework itself, same as before Vite: this repo's real regression
 * guard for the rendered app is the separate Playwright suite in ui/e2e,
 * and duplicating that behind a Storybook addon would add dependencies
 * without adding coverage. */
const config = {
  stories: ['../components/**/*.stories.@(js|jsx|ts|tsx)', '../features/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
};

export default config;
