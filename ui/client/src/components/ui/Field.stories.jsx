import { Field } from './Field.jsx';
import { Input } from './Input.jsx';
import { Select } from './Select.jsx';

export default {
  title: 'UI/Field',
  component: Field,
};

export const WithInput = {
  args: {
    label: 'Name',
    children: <Input placeholder="e.g. CpoAccess" />,
  },
};

export const WithHint = {
  args: {
    label: 'Project directory',
    hint: 'Passed as --dir to every command (same as the CLI).',
    children: <Input placeholder="/path/to/your/construct-project" />,
  },
};

export const WithSelect = {
  args: {
    label: 'Action',
    children: (
      <Select>
        <option value="move">Move (change layer)</option>
        <option value="rename">Rename (same layer)</option>
      </Select>
    ),
  },
};
