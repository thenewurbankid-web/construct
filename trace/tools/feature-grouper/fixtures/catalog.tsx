import React from "react";

type Product = { id: string; name: string; price: string; image: string };

export default function Catalog({ products, onAdd, onPage }: { products: Product[]; onAdd: (id: string) => void; onPage: (n: number) => void }) {
  return (
    <div className="shop">
      <aside className="filters">
        <h2>Filters</h2>
        <div className="group">
          <h4>Brand</h4>
          <label><input type="checkbox" name="acme" />Acme</label>
          <label><input type="checkbox" name="zen" />Zen</label>
        </div>
        <div className="group">
          <h4>Price</h4>
          <input type="range" name="price" />
          <button type="button" onClick={() => {}}>Reset</button>
        </div>
      </aside>

      <div className="content">
        <div className="hero">
          <h1>Spring sale</h1>
          <p>Up to half off</p>
          <a href="/sale" className="cta">Shop now</a>
        </div>

        <ul className="grid">
          {products.map((p) => (
            <li key={p.id} className="product">
              <img src={p.image} alt={p.name} />
              <h3>{p.name}</h3>
              <p className="price">{p.price}</p>
              <button type="button" onClick={() => onAdd(p.id)}>Add to cart</button>
            </li>
          ))}
        </ul>

        <nav className="pager" aria-label="pagination">
          <button type="button" onClick={() => onPage(1)}>Prev</button>
          <span>1</span>
          <span>2</span>
          <button type="button" onClick={() => onPage(2)}>Next</button>
        </nav>
      </div>
    </div>
  );
}
