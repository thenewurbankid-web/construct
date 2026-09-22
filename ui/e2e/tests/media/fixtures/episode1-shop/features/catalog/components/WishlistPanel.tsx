// New, first-party (not frozen): drawn to match the vendored template's look, but hand-authored. Props-only, no
// state, no handlers of its own — not opened from the live page yet in this part (there is no open/close state to
// drive it; that comes with the wishlist logic in a later part).
import type { ReactNode } from 'react';

type WishlistItem = { id: string; name: string; price: string };

type WishlistPanelProps = {
  items: WishlistItem[];
  onClose?: () => void;
  onRemove?: (id: string) => void;
  onMoveAllToCart?: () => void;
};

export function WishlistPanel({ items, onClose, onRemove, onMoveAllToCart }: WishlistPanelProps): ReactNode {
  return (
    <div className="sp-drawer" role="complementary" aria-label="Wishlist">
      <div className="sp-dh">
        Wishlist
        <button type="button" className="sp-x" aria-label="Close wishlist" onClick={onClose}>&times;</button>
      </div>
      {items.length === 0 ? (
        <div className="sp-wempty">
          <span className="sp-heart-big">&#9825;</span>
          Your wishlist is empty.
          <br />
          Tap the heart on any product to save it here.
        </div>
      ) : (
        <>
          {items.map((item) => (
            <div className="sp-witem" key={item.id}>
              <div className="sp-wimg" />
              <div>
                <div className="sp-wn">{item.name}</div>
                <div className="sp-wp">{item.price}</div>
              </div>
              <button type="button" className="sp-rm" onClick={onRemove ? () => onRemove(item.id) : undefined}>Remove</button>
            </div>
          ))}
          <div className="sp-dfoot">
            <button type="button" className="sp-btn" onClick={onMoveAllToCart}>Move all to cart</button>
          </div>
        </>
      )}
    </div>
  );
}
