'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Product = { id: number; name: string; price: number };

export default function ProductsList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then(setProducts)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p role="alert">Could not load products: {error}</p>;

  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>
          <Link href={`/products/${p.id}`}>{p.name}</Link> — ${p.price.toFixed(2)}
        </li>
      ))}
    </ul>
  );
}
