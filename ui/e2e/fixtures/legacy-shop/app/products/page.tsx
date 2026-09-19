import ProductsList from './ProductsList';

// Legacy (non-Construct) Next.js page: data fetching, state and markup all
// live together. Used as the "old project" the import demos bring in.
export default function ProductsPage() {
  return (
    <main>
      <h1>Our products</h1>
      <ProductsList />
    </main>
  );
}
