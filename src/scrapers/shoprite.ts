/**
 * ShopRite item-price search scraper.
 *
 * ShopRite uses Wakefern's platform (shared codebase with Fairway Market,
 * Price Rite, etc.). The store-selector flow sets an RSID (Retail Store ID)
 * that is embedded in the product-search URL path.
 *
 * Strategy:
 *   1. `setLocation` — navigates to shoprite.com, dismisses overlays,
 *      walks the store-finder flow, and extracts the RSID from the "select
 *      store" button's `data-testid` attribute.
 *
 *   2. `search` — navigates to the Wakefern search endpoint for the selected
 *      RSID and extracts the first product card's name, shelf price, and
 *      unit price.
 */
import { type Page } from "playwright";
import { PriceSearchResult } from "../models.js";
import { SearchScraper } from "./base.js";
import { dismissOverlays } from "./shoprite-common.js";

const BASE_URL = "https://www.shoprite.com";

export class ShopRiteSearchScraper implements SearchScraper {
  readonly name = "shoprite";
  readonly displayName = "ShopRite";

  /** Set by setLocation; used to build product-search URLs. */
  private rsid: string | null = null;

  async setLocation(page: Page, zipCode: string): Promise<void> {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissOverlays(page);

    // 1. Open the store popover (shows the current store).
    const trigger = page.locator('[data-testid="storeHeader-button-testId"]').first();
    if ((await trigger.count()) > 0) {
      await trigger.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
    }

    // 2. Click "change store" to reveal the address finder. (Without this step
    //    the address input never renders and we stay on the default store.)
    const changeStore = page.locator('[data-testid="storeDetails-button-testId-change-store"]').first();
    if ((await changeStore.count()) > 0) {
      await changeStore.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
    }

    // 3. Type the ZIP into the address autocomplete and pick the first suggestion.
    const addr = page.locator('[data-testid="AddressIntegrationInputField-TestId"]').first();
    if ((await addr.count()) > 0) {
      await addr.click({ timeout: 10_000 }).catch(() => {});
      await addr.pressSequentially(zipCode, { delay: 110 }).catch(() => {});
      await page.waitForTimeout(2_500);
      const firstOpt = page.locator('[role="option"]').first();
      if ((await firstOpt.count()) > 0) {
        await firstOpt.click({ timeout: 10_000 }).catch(() => {});
      } else {
        await addr.press("Enter").catch(() => {});
      }
      await page.waitForTimeout(3_500);
    }

    // 4. The nearest store is the first result; its RSID is encoded in the
    //    select button's data-testid (`selectStore-button-testId-<rsid>`).
    const selectBtn = page.locator('[data-testid^="selectStore-button-testId-"]').first();
    if ((await selectBtn.count()) > 0) {
      const testId = (await selectBtn.getAttribute("data-testid")) ?? "";
      const rsid = testId.replace("selectStore-button-testId-", "").trim();
      if (rsid) {
        this.rsid = rsid;
        await selectBtn.click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        return;
      }
    }

    // Fallback: extract RSID from the URL if the flow navigated there.
    const urlMatch = /\/rsid\/(\d+)/.exec(page.url());
    if (urlMatch?.[1]) this.rsid = urlMatch[1];
    // If RSID is still null, search() falls back to the root search URL.
  }

  async search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]> {
    const searchUrl = this.rsid
      ? `${BASE_URL}/sm/pickup/rsid/${this.rsid}/results?q=${encodeURIComponent(item)}`
      : `${BASE_URL}/sm/results?q=${encodeURIComponent(item)}`;

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissOverlays(page);

    try {
      await page.waitForSelector('article[data-testid^="ProductCardWrapper-"]', {
        timeout: 20_000,
      });
    } catch {
      return [];
    }

    const raw = await page.evaluate((max: number) => {
      const out: Array<{
        name: string | null;
        shelf_price: string | null;
        unit_price: string | null;
        url: string | null;
      }> = [];
      const cards = Array.from(
        document.querySelectorAll('article[data-testid^="ProductCardWrapper-"]'),
      );
      // ShopRite renders duplicate card elements for responsive (mobile/desktop)
      // layouts; the data-testid carries the product id, so dedupe on it.
      const seen = new Set<string>();
      for (const card of cards) {
        if (out.length >= max) break;
        const testId = card.getAttribute("data-testid") ?? "";
        if (seen.has(testId)) continue;
        seen.add(testId);

        // Name: the <p> whose text is only the product name (no "$" price).
        // ShopRite renders two <p>s: one with "Name, $X.XX avg/ea" (a11y) and
        // one with just the name. The plain-name <p> is the shorter one.
        const pEls = Array.from(card.querySelectorAll("p"));
        const nameEl =
          pEls.find((p) => p.textContent?.trim() && !p.textContent.includes("$")) ??
          pEls.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ??
          null;
        const name = nameEl?.textContent?.trim() ?? null;
        if (!name) continue;

        const priceEls = Array.from(
          card.querySelectorAll('[data-testid^="productCardPricing-div-testId"]'),
        );
        const linkEl = card.querySelector("a[href]");
        out.push({
          name,
          shelf_price: priceEls[0]?.textContent?.trim() ?? null,
          unit_price: priceEls[1]?.textContent?.trim() ?? null,
          url: linkEl instanceof HTMLAnchorElement ? linkEl.href : null,
        });
      }
      return out;
    }, limit);

    return raw.map((r) => ({
      store: this.name,
      query: item,
      matched_name: r.name,
      price: parseDollar(r.shelf_price),
      ...(r.unit_price ? { unit_price: r.unit_price } : {}),
      url: r.url ?? searchUrl,
    }));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRICE_RE = /\$?([\d,]+\.?\d*)/;

function parseDollar(text: string | null): number | null {
  if (!text) return null;
  const m = PRICE_RE.exec(text.replace(/,/g, ""));
  if (!m?.[1]) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}
