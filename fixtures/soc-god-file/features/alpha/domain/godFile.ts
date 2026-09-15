// Deliberately violates MODULE-001: five primary exports in a single file.
export function validateOrder(order) {
  return Boolean(order && order.id);
}

export function calculateTotal(order) {
  return (order.items || []).reduce((sum, item) => sum + item.price, 0);
}

export function applyDiscount(total, code) {
  return code === 'SAVE10' ? total * 0.9 : total;
}

export const formatOrderId = (order) => `ORDER-${order.id}`;

export class OrderAuditor {
  audit(order) {
    return validateOrder(order);
  }
}
