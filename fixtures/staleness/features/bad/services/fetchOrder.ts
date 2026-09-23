// SERVICE-003 (off by default): fetches with no way to cancel a superseded request. Neither
// the function's signature nor the fetch() call forwards a caller-owned AbortSignal, so a late
// response can land after the request that made it is no longer the one anybody wants.
export async function fetchOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`);
  return res.json();
}
