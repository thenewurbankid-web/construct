'use client';

import { formatAndCharge } from './format';

export function Total() {
  return <button onClick={() => formatAndCharge(1)}>Total</button>;
}
