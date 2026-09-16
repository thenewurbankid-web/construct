import { GlassPanel } from './GlassPanel.jsx';

export default {
  title: 'UI/GlassPanel',
  component: GlassPanel,
  parameters: {
    // The theme is dark; give the panel room to show its blur/border
    // against the page's own radial-glow background rather than a bare
    // Storybook canvas edge.
    layout: 'padded',
  },
};

export const Default = {
  args: {
    style: { padding: '20px', maxWidth: 360 },
    children: 'A translucent grey glass surface with a blurred backdrop and a subtle light border.',
  },
};

export const AsForm = {
  name: 'as="form" with className="command-form" (Dashboard usage)',
  args: {
    as: 'form',
    className: 'command-form',
    children: (
      <>
        <h3>Create</h3>
        <p className="hint">Rendered exactly as Dashboard.jsx uses it — a real &lt;form&gt;.</p>
      </>
    ),
  },
};
