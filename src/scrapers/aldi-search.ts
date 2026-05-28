/**
 * Aldi live item-price search scraper.
 *
 * Distinct from `aldi.ts` (which scrapes the weekly-specials feed). aldi.us is
 * an Instacart storefront — the same platform as delivery.publix.com — so the
 * ZIP/location handling and result extraction are shared (instacart-storefront.ts):
 * set the pickup store for the ZIP via the on-site chooser, then search.
 */
import { type Page } from "playwright";
import { PriceSearchResult } from "../models.js";
import { SearchScraper } from "./base.js";
import { setInstacartLocation, searchInstacart } from "./instacart-storefront.js";

export class AldiSearchScraper implements SearchScraper {
  readonly name = "aldi";
  readonly displayName = "Aldi";

  // ZIP-accurate via the shared Instacart chooser flow (routes through the
  // "How would you like to shop?" dialog → pickup chooser → address →
  // "Shop this store"). Aldi prices vary by location, so this matters.
  async setLocation(page: Page, zipCode: string): Promise<void> {
    await setInstacartLocation(page, zipCode, {
      storefrontUrl: "https://www.aldi.us/store/aldi/storefront",
    });
  }

  async search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]> {
    return searchInstacart(
      page,
      "https://www.aldi.us/store/aldi/s?k=",
      item,
      limit,
      this.name,
    );
  }
}
