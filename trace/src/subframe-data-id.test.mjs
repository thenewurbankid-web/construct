// LIN-197: injectPmSrc stamps the same line:col buildInventory records for a host element, so a click on the
// real-rendered Subframe page (src/pagemap-routes.mjs's /api/pagemap/render) resolves to a Page map node id
// by construction, never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectPmSrc } from "./subframe-data-id.mjs";
import { buildInventory } from "./pagemap/inventory.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => fs.readFileSync(path.join(root, "subframe-app", "src", "pages", f), "utf8");

test("injectPmSrc adds data-pm-src to host elements only, never a capitalized component", () => {
  const out = injectPmSrc(fx("PortfolioHealthFigmaRebuild.tsx"));
  assert.match(out, /data-pm-src="\d+:\d+"/);
  assert.ok(!/<Table\.Row[^>]*data-pm-src/.test(out), "a capitalized member-expression component never gets the attribute");
  assert.ok(!/<Button[^>]*data-pm-src/.test(out), "a capitalized component never gets the attribute");
});

test("injectPmSrc's line:col values equal buildInventory's for the same host elements", () => {
  for (const f of ["PortfolioHealthFigmaRebuild.tsx", "PortfolioHealthFigmaRebuild2.tsx", "RedesignedPortfolioHealth.tsx"]) {
    const src = fx(f);
    const out = injectPmSrc(src);
    const theirs = [...out.matchAll(/data-pm-src="(\d+):(\d+)"/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    const inv = buildInventory(src, { file: f });
    const mine = inv.nodes.filter((n) => n.kind !== "text" && n.id !== "root" && /^[a-z]/.test(n.tag)).map((n) => `${n.line}:${n.col}`).sort();
    assert.deepEqual(theirs, mine, f);
  }
});

test("injectPmSrc is idempotent: a second pass adds nothing new", () => {
  const src = fx("PortfolioHealthFigmaRebuild.tsx");
  const once = injectPmSrc(src);
  const twice = injectPmSrc(once);
  const count = (s) => (s.match(/data-pm-src=/g) ?? []).length;
  assert.equal(count(once), count(twice));
  assert.ok(count(once) > 0);
});
