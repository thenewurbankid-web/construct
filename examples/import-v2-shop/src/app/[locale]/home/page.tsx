import { formatTotal } from '@/utils/money';

export default function HomePage() {
  return <h1>Shop {formatTotal([{ id: 'x', total: 1 }])}</h1>;
}
