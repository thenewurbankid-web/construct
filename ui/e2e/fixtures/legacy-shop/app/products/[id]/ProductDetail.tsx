'use client';
import { useEffect, useState } from 'react';

type Product = { id: number; name: string; price: number; description: string };

export default function ProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((res) => res.json())
      .then(setProduct);
  }, [id]);

  if (!product) return <p>Loading…</p>;

  return (
    <article>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <p>${(product.price * quantity).toFixed(2)}</p>
      <label>
        Quantity
        <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
      </label>
    </article>
  );
}
