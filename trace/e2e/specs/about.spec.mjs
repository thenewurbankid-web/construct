// T16.8 — the About page ("/about", required by the release process to show the build version and changelog):
// src/ui/about.html mounts mountBuildBadge() (src/ui/build-badge.mjs) and mountAbout() (src/ui/about.mjs), both
// of which fetch the real server (/api/build, /api/about, which reads build-info.json and CHANGELOG.md) — the
// pure render* functions in about.mjs are unit-tested against fixed payloads in src/ui/about.test.mjs, but
// whether the page actually loads real build/changelog data into the DOM and the search box actually filters is
// only checkable in a browser.
import { test, expect } from "@playwright/test";

test("shows the build badge and the build/changelog sections from the real server", async ({ page }) => {
  await page.goto("/about");

  // The e2e webServer (e2e/playwright.config.mjs) runs `node ../src/server.mjs` from a dev checkout with no
  // build-info.json next to it, so build.dev is true (src/build-routes.mjs computeBuildInfo) and both the badge
  // and the "Deployed" row say so — this text is the one deterministic fact about the running build.
  await expect(page.locator("#build")).toContainText("dev build", { timeout: 15_000 });
  await expect(page.locator("#h-build")).toHaveText("Build");
  await expect(page.getByText("not deployed: this is a development checkout")).toBeVisible();

  await expect(page.locator("#h-new")).toHaveText("What's new");
  await expect(page.locator("footer a", { hasText: "CHANGELOG.md" })).toHaveAttribute("href", "/doc/CHANGELOG.md");
});

test("the changelog search box filters the release list against the real CHANGELOG.md", async ({ page }) => {
  await page.goto("/about");
  await expect(page.locator("#q")).toBeVisible({ timeout: 15_000 });

  // renderReleases() (src/ui/about.mjs) shows "Nothing matches ..." only when no release/minor/item text or id
  // contains the query; this nonsense string cannot appear in any real CHANGELOG.md entry.
  await page.locator("#q").fill("zz-no-such-changelog-entry-zz");
  await expect(page.locator("#rels")).toContainText('Nothing matches "zz-no-such-changelog-entry-zz"');

  await page.locator("#q").fill("");
  await expect(page.locator("#rels .rel")).not.toHaveCount(0);
});
