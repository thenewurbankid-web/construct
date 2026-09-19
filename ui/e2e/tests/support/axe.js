import AxeBuilder from '@axe-core/playwright';

// Reusable axe-core runner for Cockpit accessibility checks (#261).
// Tags: WCAG 2.0 A/AA, 2.1 AA and 2.2 AA (target-size). (axe-core is MPL-2.0, used unmodified, dev-only.)
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

// Known-and-accepted exclusions. Keep this list short and always explain why.
export const AXE_EXCLUDES = [
  // Next.js dev overlay/portal: injected by `next dev`, absent from production builds, not our markup.
  'nextjs-portal',
];

async function scan(page, { include, exclude = [] }) {
  let b = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (include) b = b.include(include);
  for (const sel of [...AXE_EXCLUDES, ...exclude]) b = b.exclude(sel);
  const { violations } = await b.analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => ({
      id: v.id,
      impact: v.impact,
      target: n.target.join(' '),
      help: v.help,
      helpUrl: v.helpUrl,
      summary: (n.any[0]?.message || n.failureSummary || '').split('\n')[0],
    })),
  );
}

export async function runAxe(page, opts = {}) {
  const found = await scan(page, opts);
  // Accepted false positive: the narrow layout has a fixed bottom pane bar that
  // covers content below the fold until it is scrolled up; axe evaluates
  // target-size at the current scroll position. Re-test each such target after
  // scrolling it to the middle of the viewport; only report it if it still fails.
  const out = [];
  for (const v of found) {
    if (v.id === 'target-size' && /obscured/.test(v.summary) && !v.target.includes(' ')) {
      const ok = await page.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: 'center' }); return !!e; }, v.target);
      if (ok) {
        const again = await scan(page, { ...opts, include: v.target });
        if (!again.some((x) => x.id === 'target-size')) continue;
      }
    }
    out.push(v);
  }
  return out;
}

export const isBlocking = (v) => v.impact === 'serious' || v.impact === 'critical';
export const format = (vs) => vs.map((v) => `[${v.impact}] ${v.id} ${v.target} :: ${v.summary} (${v.helpUrl})`).join('\n');
