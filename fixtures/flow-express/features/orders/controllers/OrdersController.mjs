import { isOpen } from '../domain/ordersRules.mjs';

export function list(req, res) {
  res.json({ orders: [] });
}

export function openCount(req, res) {
  res.json({ count: [].filter(isOpen).length });
}
