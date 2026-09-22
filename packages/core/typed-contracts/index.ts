// #501/#502/#510/#511/#503/#504 -- public barrel for Construct's typed-contracts mechanism.
// Layout of this directory:
//   - template.ts     Template<Props>, the shared JSX-returning function type.
//   - brand.ts         the nominal-typing primitives (Brand<T, Layer>, RefBrand<T>, FeatureBrand<T, Feature>).
//   - units.ts         the branded per-layer types + Forbid<> boundary helper + FeatureUnit<U, Feature>.
//   - propRef.ts       PropRef<T> + propRef(), the Cockpit fill-form marker.
//   - factories.ts     defineRoute/Controller/Workflow/Service/Domain/Page/Component/Expression.
//   - feature.ts       withFeature(), the framework-generated feature-identity tag (#511).
//   - provider.ts      defineProvider (React-Context-backed Provider hooks, #510).
//   - trackedState.ts  useTrackedState (typed, tracked local state, #504).
export type { Template } from './template.ts';
export type { Brand, RefBrand, FeatureBrand } from './brand.ts';
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
  ExpressionUnit,
  ExpressionUnitAny,
  AnyUnit,
  Forbid,
  FeatureUnit,
} from './units.ts';
export {
  defineComponent,
  definePage,
  defineController,
  defineRoute,
  defineWorkflow,
  defineService,
  defineDomain,
  defineExpression,
} from './factories.ts';
export { withFeature } from './feature.ts';
export type { ProviderUnit } from './provider.ts';
export { defineProvider } from './provider.ts';
export type { TrackedState } from './trackedState.ts';
export { useTrackedState } from './trackedState.ts';
