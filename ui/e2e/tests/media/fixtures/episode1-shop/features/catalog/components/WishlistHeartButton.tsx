// New, first-party (not frozen): drawn to match the vendored template's look (../../pages/shop-template.css,
// ../../../vendor/shop-template/), but hand-authored, so it stays fully visible to Construct's own tools — the
// Components screen documents it below, which is the point of this file for episode 1 part 1.
import type { ReactNode } from 'react';

type WishlistHeartButtonProps = {
  /** Which product this heart belongs to. */
  productId: string;
  /** Whether this product is already in the wishlist. */
  active: boolean;
  /**
   * Called with the product id when the heart is clicked, so a caller can add or remove it from the
   * wishlist. Declared here so wishlist behaviour can be wired in later; today's `ShopHome` (the static
   * template port) does not pass it, so the heart renders and can be pressed, but nothing happens yet
   * (a real, silent gap — see #473: Construct doesn't yet cross-check a declared prop against every
   * call site, though it does list it here, undeclared as required or not).
   */
  onToggle?: (productId: string) => void;
};

export function WishlistHeartButton({ productId, active, onToggle }: WishlistHeartButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={`sp-heart${active ? ' on' : ''}`}
      aria-pressed={active}
      aria-label={active ? 'Remove from wishlist' : 'Add to wishlist'}
      onClick={onToggle ? () => onToggle(productId) : undefined}
    >
      &#9825;
    </button>
  );
}
