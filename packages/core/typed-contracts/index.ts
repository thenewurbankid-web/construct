// #501/#502 -- public barrel for Construct's typed-contracts mechanism.
// Layout of this directory:
//   - template.ts   Template<Props>, the shared JSX-returning function type.
//   - brand.ts       the nominal-typing primitive (Brand<T, Layer>, RefBrand<T>).
//   - units.ts       the branded per-layer types + Forbid<> boundary helper.
//   - propRef.ts     PropRef<T> + propRef(), the Cockpit fill-form marker.
//   - factories.ts   defineRoute/Controller/Workflow/Service/Domain/Page/Component.
export type { Template } from './template.ts';
export type { Brand, RefBrand } from './brand.ts';
export type { PropRef } from './propRef.ts';
export { propRef } from './propRef.ts';
export type {
  LayerName,
  LayerTag,
  ComponentUnit,
  ComponentUnitAny,
  PageUnit,
  PageUnitAny,
  ControllerUnit,
  ControllerUnitAny,
  RouteProps,
  RouteUnit,
  DomainUnit,
  DomainUnitAny,
  ServiceUnit,
  ServiceUnitAny,
  HookUnit,
  HookUnitAny,
  WorkflowConfig,
  WorkflowUnit,
  AnyUnit,
  Forbid,
} from './units.ts';
export {
  defineComponent,
  definePage,
  defineController,
  defineRoute,
  defineWorkflow,
  defineService,
  defineDomain,
} from './factories.ts';
