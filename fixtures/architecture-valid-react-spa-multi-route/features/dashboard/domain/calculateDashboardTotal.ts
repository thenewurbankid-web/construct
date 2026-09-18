export function calculateDashboardTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}
