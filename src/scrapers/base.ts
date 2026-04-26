import { StoreDeals, StoreName } from "../models.js";

export interface Scraper {
  readonly name: StoreName;
  readonly displayName: string;
  /**
   * Throws on failure; the dispatcher catches and converts to a partial-success
   * error entry. `weekStarting` is used only to stamp the snapshot — most
   * scrapers ignore it and just take the live page.
   */
  scrape(weekStarting: string): Promise<StoreDeals>;
}
