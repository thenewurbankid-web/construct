// Global styles so every story renders against the real app theme (the
// #44 black/grey glassmorphism tokens in styles.css), not Storybook's
// unstyled default white canvas.
import '../src/styles.css';

/** @type { import('@storybook/react-vite').Preview } */
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
