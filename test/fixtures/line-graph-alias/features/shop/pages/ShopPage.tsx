// @line-base pages/Page
// @line-route /shop
import { Button } from '@lib/components/Button';
import { total as sum, useTotal } from '@lib/workflows/pricing';

function handleBuy() {
  return sum([1, 2]);
}

export function ShopPage() {
  const shown = useTotal([3]);
  return <Button label={`Buy ${shown}`} onPress={handleBuy} />;
}
