import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The small non-Construct "legacy shop" Next.js app the import demos trace.
// It lives in the repo (ui/e2e/fixtures/legacy-shop) and is copied to a temp
// location on demand, so specs never depend on a hand-built /tmp directory.
// The name deliberately does not start with "construct-" so test-dir cleanup
// (tools/dev/heavy.sh prunes /tmp/construct-*) never removes it mid-run.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../../fixtures/legacy-shop');

/** Copies the fixture (fresh each call) and returns { root, appDir }. */
export function materializeLegacyShop() {
  const root = path.join(os.tmpdir(), 'cx-legacy-shop');
  fs.rmSync(root, { recursive: true, force: true });
  fs.cpSync(SOURCE, root, { recursive: true });
  return { root, appDir: path.join(root, 'app') };
}

/** Writes the approved import plan for the legacy shop; returns its path. */
export function writeLegacyShopPlan(appDir) {
  const at = (rel) => path.join(appDir, rel);
  const plan = {
    feature: 'productsAi',
    units: [
      { name: 'ProductsListView', layers: ['hook', 'component'], from: at('products/ProductsList.tsx') },
      { name: 'ProductDetailView', layers: ['hook', 'component'], from: at('products/[id]/ProductDetail.tsx') },
      { name: 'ProductsPage', layers: ['page', 'controller'], from: at('products/page.tsx') },
      { name: 'ProductDetailPage', layers: ['page', 'controller'], from: at('products/[id]/page.tsx') },
    ],
  };
  const file = path.join(path.dirname(appDir), 'plan.json');
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return file;
}
