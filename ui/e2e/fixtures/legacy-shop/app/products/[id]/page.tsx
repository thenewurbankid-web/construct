import ProductDetail from './ProductDetail';

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  return (
    <main>
      <ProductDetail id={params.id} />
    </main>
  );
}
