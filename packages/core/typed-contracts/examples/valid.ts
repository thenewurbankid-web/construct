// #501/#502 step 5(a) -- a real, valid composition across every layer,
// proving (1) it compiles clean under this directory's own tsconfig.json,
// and (2) the branded type is correctly inferred at each step (checked
// below via `infer` + a type-level assertion, not just "no red squiggles").
// Authored with React.createElement rather than JSX syntax deliberately
// (see jsx-global.d.ts's doc comment) -- nothing here depends on that
// choice; a real project would author these as .tsx with real JSX.
import * as React from 'react';
import {
  defineDomain,
  defineService,
  defineWorkflow,
  defineComponent,
  definePage,
  defineController,
  defineRoute,
  propRef,
  type DomainUnit,
  type ServiceUnit,
  type ComponentUnit,
  type PageUnit,
  type ControllerUnit,
  type PropRef,
} from '../index.ts';

// ---- domain --------------------------------------------------------
// Pure: no props slot could reference another unit even if we tried
// (Forbid<Props, never> — see factories.ts's defineDomain).
interface Item { price: number; quantity: number }
const calculateTotal = defineDomain<{ items: Item[] }, number>('calculateTotal', ({ items }) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0),
);

// ---- service ---------------------------------------------------------
// May reference domain units (canImport: ['domain', 'types']).
interface CartServiceProps { cart: { calculateTotal: typeof calculateTotal } }
const cartTotal = defineService<CartServiceProps, number>('cartTotal', ({ cart }) =>
  cart.calculateTotal({ items: [{ price: 10, quantity: 2 }] }),
);

// ---- workflow ------------------------------------------------------
// May reference service/domain units (canImport: ['service', 'domain', 'types']).
interface CheckoutWorkflowProps { cartTotal: typeof cartTotal }
const CheckoutWorkflow = defineWorkflow<CheckoutWorkflowProps>('CheckoutWorkflow', () => ({
  id: 'checkout',
  initial: 'idle',
  states: { idle: {}, paying: {}, done: { type: 'final' } },
}));
void CheckoutWorkflow;

// ---- component ---------------------------------------------------------
// May reference other component units (canImport: ['component', 'types']).
interface TotalBadgeProps { amount: number }
const TotalBadge = defineComponent<TotalBadgeProps>('TotalBadge', (props) =>
  React.createElement('span', null, `$${props.amount}`),
);

// ---- page --------------------------------------------------------------
// Same allowed set as component. `badge` is a PropRef<ComponentUnit<...>> --
// "pick an already-defined component", not a literal value.
interface CartPageProps { badge: PropRef<ComponentUnit<TotalBadgeProps>>; amount: number }
const CartPage = definePage<CartPageProps>('CartPage', (props) =>
  React.createElement('div', null, React.createElement(props.badge as unknown as ComponentUnit<TotalBadgeProps>, { amount: props.amount })),
);

// ---- controller ----------------------------------------------------
// The widest slot: workflow/hook/service/page/component/domain all allowed.
interface CheckoutControllerProps {
  page: PropRef<PageUnit<CartPageProps>>;
  amount: number;
  badge: PropRef<ComponentUnit<TotalBadgeProps>>;
}
const CheckoutController = defineController<CheckoutControllerProps>('CheckoutController', (props) =>
  React.createElement(props.page as unknown as PageUnit<CartPageProps>, { amount: props.amount, badge: props.badge }),
);

// ---- route -----------------------------------------------------------
// May only reference a controller unit.
interface CheckoutRouteProps { controller: PropRef<ControllerUnit<CheckoutControllerProps>> }
const CheckoutRoute = defineRoute<CheckoutRouteProps>('CheckoutRoute', (props) =>
  React.createElement(
    props.controller as unknown as ControllerUnit<CheckoutControllerProps>,
    { page: propRef(CartPage), amount: 20, badge: propRef(TotalBadge) },
  ),
);
void CheckoutRoute;

// ---- prove the branded type is really inferred, not widened to `any` ---
type InferredPageProps = typeof CartPage extends PageUnit<infer P> ? P : never;
const _pageCheck: InferredPageProps extends CartPageProps ? true : false = true;
void _pageCheck;

type InferredControllerProps = typeof CheckoutController extends ControllerUnit<infer P> ? P : never;
const _controllerCheck: InferredControllerProps extends CheckoutControllerProps ? true : false = true;
void _controllerCheck;

// Runtime name/introspection is also real (asserted at runtime in
// test/typed-contracts.test.mjs) -- checked here only at the type level:
// `unitName`/`unitLayer` are ordinary, non-branded properties.
const _name: string = calculateTotal.unitName;
const _layer: 'domain' = calculateTotal.unitLayer;
void _name;
void _layer;

export { calculateTotal, cartTotal, CheckoutWorkflow, TotalBadge, CartPage, CheckoutController, CheckoutRoute };
