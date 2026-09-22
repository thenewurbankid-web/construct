// #504 -- a real, compiling `use<Name>State` hook built the sanctioned way (via
// useTrackedState), proving the shape HOOK-001 (packages/core/architecture-enforcer.mjs)
// checks for actually compiles and type-checks. `tsc` does not itself enforce React's
// rules-of-hooks (that is eslint-plugin-react-hooks' job, not this project's typed-contracts
// mechanism), so this compiling cleanly is not proof it is safe to CALL outside a component --
// see trackedState.ts's own module doc comment for why the runtime behavior itself can only be
// proven at the type level, same as defineProvider's useProvider().
import { useTrackedState } from '../index.ts';

interface CartState {
  total: number;
  setTotal: (next: number | ((prev: number) => number)) => void;
  // A directly-coupled derivation -- HOOK-001 allows this (it reads the same tracked value,
  // nothing unrelated) but would NOT allow, say, a fetch() call or a useEffect alongside it.
  isEmpty: boolean;
}

export function useCartState(): CartState {
  const [total, setTotal] = useTrackedState<number>('total', 0);
  return { total, setTotal, isEmpty: total === 0 };
}

// ---- prove the tuple's real element types are inferred, not widened ---------------------
const _totalCheck: ReturnType<typeof useCartState>['total'] extends number ? true : false = true;
void _totalCheck;
