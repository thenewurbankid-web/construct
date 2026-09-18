import { test, expect } from '@playwright/test';

// Epic 6.3 (#99) — the Qwen Coder size picker. Tags/sizes are the real
// Ollama-library values verified live against https://ollama.com/library/
// qwen2.5-coder while building this feature (see domain/QwenModels.tsx's
// comment) — not asserted against Ollama itself here (no live daemon in
// this sandbox), but the UI/persistence behavior around them is real.

test('model picker offers real Qwen Coder sizes, recommends the smallest, and persists a selection across reload', async ({ page }) => {
  await page.goto('/ollama');

  const picker = page.locator('.ollama-model-picker');
  await expect(picker.getByRole('heading', { name: 'Qwen Coder model' })).toBeVisible();

  // All six real size tags are offered.
  for (const size of ['0.5B', '1.5B', '3B', '7B', '14B', '32B']) {
    await expect(picker.getByText(size, { exact: true })).toBeVisible();
  }

  // The smallest is the default selection and is labeled Recommended.
  const recommendedOption = picker.locator('.ollama-model-picker-option', { has: page.locator('input[value="qwen2.5-coder:0.5b"]') });
  await expect(recommendedOption.getByText('Recommended')).toBeVisible();
  await expect(recommendedOption.locator('input[type="radio"]')).toBeChecked();
  await page.screenshot({ path: 'screenshots/ollama-model-picker.png', fullPage: true });

  // Pick a different size — persists via localStorage, survives a reload.
  const largerOption = picker.locator('.ollama-model-picker-option', { has: page.locator('input[value="qwen2.5-coder:7b"]') });
  await largerOption.locator('input[type="radio"]').check();
  await expect(largerOption.locator('input[type="radio"]')).toBeChecked();

  await page.reload();
  const largerAfterReload = page.locator('.ollama-model-picker .ollama-model-picker-option', { has: page.locator('input[value="qwen2.5-coder:7b"]') });
  await expect(largerAfterReload.locator('input[type="radio"]')).toBeChecked();
  await page.screenshot({ path: 'screenshots/ollama-model-picker-selected.png', fullPage: true });
});
