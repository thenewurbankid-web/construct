import React, { useState } from 'react';
import { useGetItemsQuery, useBuyItemMutation } from '@/lib/api';
import { priceLabel, seatsFor } from '@/lib/price';
import { toast } from '@/lib/toast';

export default function Shop() {
  const [tier, setTier] = useState<'free' | 'pro' | 'team'>('free');
  const { data, isLoading, isError } = useGetItemsQuery({ tier });
  const [buy] = useBuyItemMutation();

  if (isLoading) return <p>Loading</p>;
  if (isError) return <p role="alert">Could not load items</p>;

  const onBuy = async (id: string) => {
    try {
      await buy({ id }).unwrap();
      toast.show('Bought');
    } catch {
      toast.show('Purchase failed');
    }
  };

  return (
    <div>
      <button onClick={() => setTier(tier === 'free' ? 'pro' : 'free')}>Switch tier</button>
      <span>{seatsFor(tier)} seats</span>
      {data && data.items.length === 0 && <p>No items</p>}
      <ul>
        {(data?.items ?? []).map((item) => (
          <li key={item.id}>
            {item.name} {priceLabel(item.price)}
            <button aria-label={`buy ${item.id}`} onClick={() => onBuy(item.id)}>Buy</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
