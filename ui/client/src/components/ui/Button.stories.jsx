import { Button } from './Button.jsx';

export default {
  title: 'UI/Button',
  component: Button,
  args: {
    children: 'Run create',
  },
};

export const Primary = {
  args: { variant: 'primary' },
};

export const Ghost = {
  args: { variant: 'ghost' },
};

export const Disabled = {
  args: { disabled: true, children: 'Running…' },
};
