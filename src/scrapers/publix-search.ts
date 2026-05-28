/**
 * Publix live item-price search scraper.
 *
 * Publix's own site (publix.com) gates its grocery catalog behind a
 * store-selection flow that doesn't drive headlessly. The real online grocery
 * is delivery.publix.com — an Instacart storefront. We set the pickup store
 * for the ZIP via the on-site chooser, then search in-session so the store
 * sticks (see instacart-storefront.ts for why). Pickup prices ≈ in-store.
 */
import { type Page } from "playwright";
import { PriceSearchResult } from "../models.js";
import { SearchScraper } from "./base.js";
import { setInstacartLocation, searchInstacart } from "./instacart-storefront.js";

export class PublixSearchScraper implements SearchScraper {
  readonly name = "publix";
  readonly displayName = "Publix";

  async setLocation(page: Page, zipCode: string): Promise<void> {
    await setInstacartLocation(page, zipCode, {
      storefrontUrl: "https://delivery.publix.com/store/publix/storefront",
    });
  }

  async search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]> {
    return searchInstacart(
      page,
      "https://delivery.publix.com/store/publix/s?k=",
      item,
      limit,
      this.name,
    );
  }
}
