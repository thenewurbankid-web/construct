export async function checkout(orderId: string) {
  return fetch(`/api/checkout/${orderId}`);
}
