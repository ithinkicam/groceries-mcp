import { type Page } from "playwright";
import { PriceSearchResult, StoreDeals, DealStoreName } from "../models.js";

export interface Scraper {
  readonly name: DealStoreName;
  readonly displayName: string;
  /**
   * Throws on failure; the dispatcher catches and converts to a partial-success
   * error entry. `weekStarting` is used only to stamp the snapshot — most
   * scrapers ignore it and just take the live page.
   */
  scrape(weekStarting: string): Promise<StoreDeals>;
}

/**
 * A stateful scraper that can look up live shelf prices for individual items.
 *
 * One instance per search session — `setLocation` writes state (e.g. RSID) that
 * `search` reads back, so instances must not be shared across concurrent sessions
 * or reused after the zip code changes.
 */
export interface SearchScraper {
  readonly name: string;
  readonly displayName: string;
  /**
   * Navigate to the store's site and select the nearest location for `zipCode`.
   * Called once before any `search` calls on this instance.
   * May be a no-op for stores whose search endpoint is location-independent.
   */
  setLocation(page: Page, zipCode: string): Promise<void>;
  /**
   * Search for a single item and return up to `limit` matches in the store's
   * own relevance order. Returns an empty array if no matching product is
   * found. Never throws for "not found" — only throws on network/browser
   * errors (a soft store-side block may instead return a single entry with
   * `error` set).
   */
  search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]>;
}
