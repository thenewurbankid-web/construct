// The wrapper around the frozen ShopHome page (README.md's "Wrapping frozen, externally-authored UI"). Part 1 of
// episode 1: no hook, no workflow, no state yet on purpose — this controller only forwards a fixed list of
// products as props. Wiring `onToggle` to real wishlist behaviour (a hook + workflow) is a later part.
import { ShopHome, type ShopProduct } from '../pages/ShopHome';

const SAMPLE_PRODUCTS: ShopProduct[] = [
  { id: 'p1', name: 'Fancy Product', price: '$34.00', wishlisted: false },
  { id: 'p2', name: 'Special Item', price: '$37.00', wasPrice: '$50.00', sale: true, wishlisted: true },
  { id: 'p3', name: 'Sale Item', price: '$40.00', wishlisted: false },
  { id: 'p4', name: 'Popular Item', price: '$43.00', wishlisted: false },
  { id: 'p5', name: 'Weekend Tote', price: '$46.00', wasPrice: '$50.00', sale: true, wishlisted: false },
  { id: 'p6', name: 'Linen Throw', price: '$49.00', wishlisted: false },
  { id: 'p7', name: 'Table Runner', price: '$52.00', wishlisted: true },
  { id: 'p8', name: 'Ceramic Vase', price: '$55.00', wasPrice: '$50.00', sale: true, wishlisted: false },
];

export function WishlistController() {
  return <ShopHome products={SAMPLE_PRODUCTS} />;
}
