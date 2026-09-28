// CON-8 R1.2 — a per-Ask Suggest button on the demo shell's option-style Asks, next to "Skip for now". It is
// only shown when Suggest is reachable (/api/demo/status .suggest), same gate the pre-run "Let Suggest answer
// what it can" toggle already uses. This is a genuine browser check: the button's presence, its busy state and
// its abstain/unreachable message only exist once src/ui/demo.mjs runs in a DOM (see demo-front-door.spec.mjs).
import { test, expect } from "@playwright/test";

test("an option Ask either offers Suggest, or has no Suggest button when it isn't reachable", async ({ page }) => {
  // A clean example (no saved Ledger answers), so useSaved:true still surfaces fresh Asks instead of skipping
  // straight to the done card.
  await page.request.post("/api/reset", { data: { example: "invoices" } });
  await page.goto("/");
  const status = await (await page.request.get("/api/demo/status")).json();

  // Invoices ("Lots of Asks") reliably reaches an option-style Ask early.
  await page.locator('.scen-card[data-id="invoices"]').click();
  const wireButton = page.locator("#bWire");
  await expect(wireButton).toBeEnabled({ timeout: 15_000 });
  await wireButton.click();

  const ask = page.locator("#sideBody .ask");
  await expect(ask).toBeVisible({ timeout: 15_000 });
  const optionAsk = page.locator("#sideBody .ask:has(.opt[data-answer])").first();
  await expect(optionAsk).toBeVisible({ timeout: 15_000 });
  const suggestBtn = optionAsk.locator("[data-suggest-ask]");

  if (!status.suggest) {
    // Suggest isn't reachable in this environment (no AI provider configured): the button must not render at all,
    // and answering still works normally through the existing option buttons.
    await expect(suggestBtn).toHaveCount(0);
    return;
  }

  await expect(suggestBtn).toBeVisible();
  await suggestBtn.click();
  // Busy state first: the ask's controls disable and a "checking this Ask" line shows.
  await expect(page.locator("#sideBody .ask-suggest.busy")).toBeVisible();
  // Then either it answers automatically (the side panel moves on to the next Ask or the done card), or it
  // leaves this Ask open with an inline abstain/unreachable note — never a dead end either way.
  await expect(page.locator("#sideBody .ask-suggest.busy")).toBeHidden({ timeout: 15_000 });
  const note = page.locator("#sideBody .ask-suggest.note");
  const doneOrNextAsk = page.locator("#sideBody .card-msg, #sideBody .ask");
  await expect(note.or(doneOrNextAsk).first()).toBeVisible();
  if (await note.count()) {
    await expect(page.locator("#sideBody .ask")).toBeVisible(); // the Ask itself is still open, not dead-ended
    console.log(`Suggest abstained/unreachable: ${await note.textContent()}`);
  }
});
