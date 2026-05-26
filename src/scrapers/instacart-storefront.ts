/**
 * Shared logic for Instacart-backed storefronts (delivery.publix.com,
 * aldi.us/store/aldi). Both expose the same product DOM and the same
 * pickup-location chooser, so Aldi and Publix search share this module.
 *
 * Setting the store deterministically (this was the hard part):
 *   1. Open the pickup chooser. Publix: clicking "Change store" opens it
 *      directly. Aldi: that's a coin-flip (sometimes a store-details popover),
 *      so we first open the "How would you like to shop?" dialog via the
 *      "Delivery · <zip>" header pill, then click "Change store" INSIDE it —
 *      which opens the full chooser reliably.
 *   2. Click the "Near <zip>" pill → the "Choose address" entry.
 *   3. Type the ZIP. Aldi requires clicking the role=option autocomplete
 *      suggestion; Publix accepts Enter. We try the option, then fall back.
 *   4. The store list refreshes to the ZIP's metro. Select the first (nearest)
 *      store row — it's a <button> inside div[role=region] > ul > li, and the
 *      map overlay can intercept clicks, so we force-click. Confirm if prompted.
 *
 * The selected store persists across navigation, so search() just navigates to
 * the search URL. Pickup prices ≈ in-store prices.
 *
 * NOTE: Aldi's chooser is fiddlier than Publix's; setLocation is best-effort.
 * If it fails, the storefront keeps its IP-default store (search still works,
 * just not ZIP-accurate). Aldi prices DO vary by location, so that's a real
 * (documented) gap when the flow doesn't complete.
 */
import { type Page } from "playwright";
import { PriceSearchResult } from "../models.js";

/** Click the first VISIBLE element matching `selector` (force, to bypass overlays). */
async function clickFirstVisible(page: Page, selector: string, timeout = 8000): Promise<boolean> {
  const loc = page.locator(selector);
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout, force: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

/** True if any element matching `selector` is visible. */
async function anyVisible(page: Page, selector: string): Promise<boolean> {
  const loc = page.locator(selector);
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

export interface InstacartLocationOpts {
  storefrontUrl: string;
}

const NEAR_PILL = ':text-matches("\\bNear\\s*\\d{5}")';

export async function setInstacartLocation(
  page: Page,
  zipCode: string,
  opts: InstacartLocationOpts,
): Promise<void> {
  await page.goto(opts.storefrontUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(3_000);

  const chooserOpen = () => anyVisible(page, NEAR_PILL);

  // --- 1. Open the full pickup chooser. ---
  // Publix path: "Change store" opens it directly.
  await clickFirstVisible(page, 'button:has-text("Change store"), a:has-text("Change store")');
  await page.waitForTimeout(2_500);

  // Aldi path: route through the shop-mode dialog (deterministic). Retry a couple times.
  for (let attempt = 0; attempt < 2 && !(await chooserOpen()); attempt++) {
    await page.keyboard.press("Escape").catch(() => {}); // close any store-details popover
    await page.waitForTimeout(800);
    await clickFirstVisible(
      page,
      'button:has-text("Delivery ·"), button:has-text("Pickup ·"), [role="button"]:has-text("Delivery ·")',
    );
    await page.waitForTimeout(2_000);
    await clickFirstVisible(page, 'button:has-text("Change store"), a:has-text("Change store")');
    await page.waitForTimeout(2_500);
  }

  // --- 2. Open the "Choose address" entry via the "Near <zip>" pill. ---
  const nearPill = page.getByText(/\bNear\s*\d{5}/i).first();
  if (await nearPill.isVisible().catch(() => false)) {
    await nearPill.click({ force: true, timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
  }

  // --- 3. Type the ZIP and accept the suggestion. ---
  // The address box has no placeholder attribute; it's the visible text input
  // that isn't the product search bar.
  const addr = page
    .locator('input[type="text"]:not(#search-bar-input)')
    .filter({ visible: true })
    .first();
  if ((await addr.count()) > 0) {
    await addr.click({ timeout: 5_000 }).catch(() => {});
    await addr.pressSequentially(zipCode, { delay: 120 }).catch(() => {});
    await page.waitForTimeout(2_500);
    // Aldi: must click the role=option suggestion. Publix: Enter works.
    const opt = page.getByRole("option").filter({ visible: true }).first();
    if ((await opt.count()) > 0) {
      await opt.click({ force: true, timeout: 5_000 }).catch(() => {});
    } else {
      await addr.press("Enter").catch(() => {});
    }
    await page.waitForTimeout(3_500);
  }

  // --- 4. Select the first (nearest) store, then COMMIT via "Shop this store". ---
  // Each store row is a <button> wrapping a "Store X.X mi away" line; the map
  // overlay intercepts normal clicks, so locate the row by that distance text
  // and click its enclosing button via JS. (Plain selectors like
  // `ul li button` match product "Add" buttons in other regions.)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("p, span, div"));
    const distEl = els.find((e) =>
      /Store\s+[\d.]+\s*mi away/i.test(
        Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(""),
      ),
    );
    const btn = (distEl?.closest("button") ?? null) as HTMLElement | null;
    if (btn) {
      btn.scrollIntoView();
      btn.click();
    }
  });
  await page.waitForTimeout(2_500);

  // Selecting a store opens a "Shop this store" popup; clicking it is what makes
  // the store change actually persist (without it the active store reverts).
  await clickFirstVisible(page, 'button:has-text("Shop this store")', 6_000);
  await page.waitForTimeout(3_000);
}

/**
 * Search the storefront for `item`. The pickup store chosen by
 * setInstacartLocation persists across navigation, so we navigate to the
 * search URL and read results. Returns up to `limit` cards, organic first.
 */
export async function searchInstacart(
  page: Page,
  searchUrlBase: string,
  item: string,
  limit: number,
  storeName: string,
): Promise<PriceSearchResult[]> {
  await page.goto(searchUrlBase + encodeURIComponent(item), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(3_000);
  try {
    await page.waitForSelector('[data-item-card="true"]', { timeout: 20_000 });
  } catch {
    return [];
  }

  const raw = await page.evaluate((max: number) => {
    const organic: Array<{ name: string | null; priceText: string; url: string | null }> = [];
    const sponsored: Array<{ name: string | null; priceText: string; url: string | null }> = [];
    const cards = Array.from(document.querySelectorAll('[data-item-card="true"]'));
    for (const card of cards) {
      const headingEl = card.querySelector('[role="heading"]');
      const imgEl = card.querySelector('img[data-testid="item-card-image"]');
      const name =
        headingEl?.textContent?.trim() ||
        (imgEl instanceof HTMLImageElement ? imgEl.alt.trim() : "") ||
        null;
      if (!name) continue;

      const priceSpans = Array.from(card.querySelectorAll("span.screen-reader-only"));
      const currentPriceSpan = priceSpans.find((s) =>
        s.textContent?.toLowerCase().includes("current price"),
      );
      const priceText = currentPriceSpan?.textContent?.trim() ?? "";

      const linkEl = card.querySelector('a[href*="/products/"]') ?? card.querySelector("a[href]");
      const url = linkEl instanceof HTMLAnchorElement ? linkEl.href : null;

      const rec = { name, priceText, url };
      const flat = (card.textContent ?? "").replace(/\s+/g, "").toLowerCase();
      if (flat.includes("sponsored")) sponsored.push(rec);
      else organic.push(rec);
    }
    return [...organic, ...sponsored].slice(0, max);
  }, limit);

  const PRICE_RE = /current price:?\s*\$(\d+\.\d{2})/i;
  return raw.map((r) => {
    const m = PRICE_RE.exec(r.priceText);
    const price = m?.[1] !== undefined ? parseFloat(m[1]) : null;
    return {
      store: storeName,
      query: item,
      matched_name: r.name,
      price: isNaN(price ?? NaN) ? null : price,
      url: r.url ?? page.url(),
    };
  });
}
