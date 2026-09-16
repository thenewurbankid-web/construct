import { Input } from './Input.jsx';

export default {
  title: 'UI/Input',
  component: Input,
};

export const Text = {
  args: { placeholder: 'e.g. CpoAccess' },
};

export const WithValue = {
  args: { defaultValue: '/path/to/your/construct-project' },
};

export const Checkbox = {
  args: { type: 'checkbox' },
};
