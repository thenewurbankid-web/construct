export function totalOf(items) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}
