export type Payment = { id: string; amount: number };

/** Charge a customer through the payments API. */
export async function charge(amount: number): Promise<Payment> {
  const res = await fetch('/api/charge', { method: 'POST', body: JSON.stringify({ amount }) });
  return res.json();
}
