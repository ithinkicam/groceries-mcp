import { type Page } from "playwright";

/**
 * Dismiss ShopRite's modal / cookie / age-gate overlays so they don't block
 * clicks. Best-effort — silently skips any overlay that isn't present.
 * Shared by the ShopRite search and deals scrapers.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  const selectors = [
    '[data-testid="modal-close-button"]',
    '[aria-label="Close"]',
    'button:has-text("Accept")',
    'button:has-text("Close")',
    "#onetrust-accept-btn-handler",
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}
