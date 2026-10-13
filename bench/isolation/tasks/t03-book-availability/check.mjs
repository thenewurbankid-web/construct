// Deterministic check. t: harness helpers (lib/check-runner.mjs); fail(msg) records one failure.
export default async function check(t, fail) {
  const Page = t.component();
  const a = await t.render(t.h(Page, { params: { id: 'salt-and-lanterns' } }));
  if (!t.text(a).includes('Available')) fail('available book does not say "Available"');
  if (t.text(a).includes('On loan')) fail('available book says "On loan"');
  if (/\b(true|false)\b/.test(t.text(a))) fail('raw true/false still visible');
  const b = await t.render(t.h(Page, { params: { id: 'winter-ferry' } }));
  if (!t.text(b).includes('On loan')) fail('on-loan book (winter-ferry) does not say "On loan"');
  if (/\bAvailable\b/.test(t.text(b))) fail('on-loan book says "Available"');
}
