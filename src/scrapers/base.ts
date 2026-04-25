/**
 * Base interface every store scraper implements. Keeps the dispatcher simple:
 * `scrape(week)` is the only contract.
 */
import { StoreDeals, StoreName } from "../models.js";

export interface Scraper {
  /** Internal store name used for cache paths and tool args. */
  readonly name: StoreName;
  /** Human-friendly display name in the returned payload. */
  readonly displayName: string;
  /**
   * Fetch the current week's deals from the store. Throws on failure;
   * the dispatcher will catch and convert to a partial-success error entry.
   *
   * `weekStarting` is the Wednesday of the ad week we're scraping for, used
   * to stamp the snapshot. Most scrapers ignore it and just take the live page.
   */
  scrape(weekStarting: string): Promise<StoreDeals>;
}
