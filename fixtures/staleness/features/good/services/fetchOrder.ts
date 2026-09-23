// SERVICE-003 (off by default): forwards the caller's AbortSignal both ways the rule checks --
// defineService()'s fn declares `signal: AbortSignal` in its first parameter's type, and the
// fetch() call forwards it in its init object -- so a superseded request's response never lands.
import { defineService } from '../../../../packages/core/typed-contracts/factories.ts';

export const fetchOrder = defineService(
  'fetchOrder',
  async ({ id, signal }: { id: string; signal: AbortSignal }) => {
    const response = await fetch(`/api/orders/${id}`, { signal });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  },
);
