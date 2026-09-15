import { BetaPage } from '../pages/BetaPage';
// Reaches directly into alpha's domain internals instead of alpha's index.ts.
import { isAlphaValid } from '../../alpha/domain/alphaRules';

export function BetaController() {
  return isAlphaValid('alpha-1') ? <BetaPage /> : null;
}
