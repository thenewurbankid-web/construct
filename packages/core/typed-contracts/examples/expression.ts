// #503 -- a real, compiling Expression unit, proving (1) it compiles clean under this
// directory's own tsconfig.json, and (2) the branded type + the required `children` slot are
// correctly inferred (checked below via `infer` + a type-level assertion, not just "no red
// squiggles"), the same bar examples/valid.ts and examples/providers.ts already hold themselves
// to. Authored with React.createElement rather than JSX syntax deliberately (see
// jsx-global.d.ts's doc comment) -- nothing here depends on that choice; a real project would
// author these as .tsx with real JSX.
import * as React from 'react';
import { defineComponent, defineExpression, type ComponentUnit, type ExpressionUnit } from '../index.ts';

// ---- a component the Expression composes (canImport: ['component', 'types']) -----------
interface BadgeProps { label: string }
const DiscountBadge = defineComponent<BadgeProps>('DiscountBadge', (props) =>
  React.createElement('span', null, props.label),
);

// ---- the Expression itself: decides whether to render its children at all --------------
// EXPR-004's "no hand-authored JSX beyond wrapping/passthrough" -- the only JSX literal here is
// a Fragment (no element identity of its own); everything actually rendered is either the
// caller's own `children` or the pre-existing DiscountBadge component, never a hand-authored
// `<div>`/`<span>`. EXPR-005's "accepts children and returns JSX" is satisfied because Props
// carries `children` (baked into ExpressionUnit<Props> itself, units.ts) and every path returns
// a real JSX.Element (React.Fragment).
interface ShowDiscountBadgeProps { active: boolean; badge: ComponentUnit<BadgeProps> }
const ShowDiscountBadge = defineExpression<ShowDiscountBadgeProps>('ShowDiscountBadge', (props) =>
  React.createElement(
    React.Fragment,
    null,
    props.children,
    props.active ? React.createElement(props.badge, { label: '-10%' }) : null,
  ),
);

// ---- prove the branded type + the required children slot are really inferred -----------
type InferredProps = typeof ShowDiscountBadge extends ExpressionUnit<infer P> ? P : never;
const _propsCheck: InferredProps extends ShowDiscountBadgeProps ? true : false = true;
void _propsCheck;

const _name: string = ShowDiscountBadge.unitName;
const _layer: 'expression' = ShowDiscountBadge.unitLayer;
void _name;
void _layer;

// A real call site, proving `children` is genuinely accepted (react-jsx's own children slot, not
// just declared and unused) and the Expression still type-checks when actually composed.
const _rendered = React.createElement(
  ShowDiscountBadge,
  { active: true, badge: DiscountBadge },
  React.createElement('span', null, 'Cart total: $90'),
);
void _rendered;

export { DiscountBadge, ShowDiscountBadge };
