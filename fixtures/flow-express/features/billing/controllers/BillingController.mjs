import { totalOf } from '../domain/billingRules.mjs';

export function list(req, res) {
  res.json({ items: [] });
}

export function total(req, res) {
  res.json({ total: totalOf([]) });
}
