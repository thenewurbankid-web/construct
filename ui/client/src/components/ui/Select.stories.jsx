import { Select } from './Select.jsx';

export default {
  title: 'UI/Select',
  component: Select,
};

export const Default = {
  render: (args) => (
    <Select {...args}>
      <option value="feature">A new feature (all 7 layer folders)</option>
      <option value="layer">A vertical slice (several layers of one logical unit)</option>
      <option value="single">A single layer file</option>
    </Select>
  ),
};
