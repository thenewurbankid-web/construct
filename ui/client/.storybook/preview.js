// Global styles so every story renders against the real app theme (the
// #44 black/grey glassmorphism tokens), not Storybook's unstyled default
// white canvas. Path updated from src/styles.css to app/globals.css after
// the Next.js migration (#70-74) — same file, same tokens, just moved.
import '../app/globals.css';

/** @type { import('@storybook/nextjs').Preview } */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'construct-dark',
      values: [{ name: 'construct-dark', value: '#060709' }],
    },
  },
};

export default preview;
