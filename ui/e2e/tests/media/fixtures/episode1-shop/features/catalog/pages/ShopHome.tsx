// Frozen: a TypeScript/CSS port of Start Bootstrap "Shop Homepage" (MIT, ../../vendor/shop-template/LICENSE and
// README.md for the source templates and verification date). Declared in architecture.yml under `frozen:` —
// Construct's create/refactor/pipeline commands refuse to touch this file; a controller wraps it instead.
//
// Static and presentational only, on purpose (episode 1 part 1): no useState, no data fetching, no event handling
// beyond what WishlistHeartButton already renders for itself. Every value below is a prop; nothing is computed from
// the network or from local state. Clicking a heart does nothing yet — see WishlistHeartButton's `onToggle` and #473.
import type { ReactNode } from 'react';
import './shop-template.css';
import { WishlistHeartButton } from '../components/WishlistHeartButton';

export type ShopProduct = {
  id: string;
  name: string;
  price: string;
  wasPrice?: string;
  sale?: boolean;
  wishlisted: boolean;
};

export type ShopHomeProps = {
  products: ShopProduct[];
};

export function ShopHome({ products }: ShopHomeProps): ReactNode {
  const wishlistCount = products.filter((p) => p.wishlisted).length;
  return (
    <div className="sp-root">
      <nav className="sp-nav">
        <span className="sp-brand">North &amp; Pine</span>
        <a className="on">Home</a>
        <a>About</a>
        <a>Shop</a>
        <span className="sp-spacer" />
        <span className="sp-wish">
          <span className="sp-heart-ico">&#9825;</span>Wishlist<span className="sp-count">{wishlistCount}</span>
        </span>
        <span className="sp-cart">&#128722; Cart<span className="sp-count">0</span></span>
      </nav>
      <div className="sp-hero">
        <h1>Shop in style</h1>
        <p>North &amp; Pine &middot; a static template page, no backend behind it yet</p>
      </div>
      <div className="sp-grid">
        {products.map((product) => (
          <div className="sp-card" key={product.id}>
            {product.sale && <span className="sp-sale">Sale</span>}
            <WishlistHeartButton productId={product.id} active={product.wishlisted} />
            <div className="sp-img">450&times;300</div>
            <div className="sp-body">
              <h5>{product.name}</h5>
              <div className="sp-price">
                {product.wasPrice && <span className="was">{product.wasPrice}</span>}
                {product.price}
              </div>
            </div>
            <div className="sp-foot">
              <span className="sp-btn">{product.sale ? 'View options' : 'Add to cart'}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="sp-license">Layout adapted from Start Bootstrap &quot;Shop Homepage&quot; / &quot;Shop Item&quot; (MIT) &middot; vendor/shop-template/LICENSE</div>
    </div>
  );
}
