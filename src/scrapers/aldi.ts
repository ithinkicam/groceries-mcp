/**
 * Aldi scraper — STATUS: needs rework as of April 2026.
 *
 * Aldi changed `/weekly-specials/weekly-ads` so it no longer renders the ad
 * inline. The page now shows a "Start Shopping" call-to-action; products are
 * behind a click that loads a separate cart-building UI. The legacy
 * `[role="button"][aria-label]` iframe pattern from the Python version
 * doesn't exist anymore.
 *
 * Two viable directions when picking this up (likely from the Mac Mini, with
 * Playwright Inspector running interactively):
 *   1. Drive the "Start Shopping" flow — `page.click('text=Start Shopping')`
 *      and then walk whatever product list renders.
 *   2. Find the underlying product API. The new UI almost certainly fetches
 *      a JSON list of weekly-ad items at some `info.aldi.us/api/...` endpoint.
 *      DevTools network panel will reveal it; hitting it directly with `fetch`
 *      is faster + less brittle than driving the UI.
 *
 * For now this scraper throws so the dispatcher reports it as unavailable.
 * Publix and Lidl continue to work; the meal-planner skill already handles
 * partial success.
 */
import { StoreDeals } from "../models.js";
import { Scraper } from "./base.js";

const ALDI_URL = "https://www.aldi.us/weekly-specials/weekly-ads";

export class AldiScraper implements Scraper {
  readonly name = "aldi" as const;
  readonly displayName = "Aldi";

  async scrape(_weekStarting: string): Promise<StoreDeals> {
    throw new Error(
      `Aldi scraper not implemented for the post-2026-04 page layout. ` +
        `The weekly ad is no longer rendered inline at ${ALDI_URL}; ` +
        `it sits behind a "Start Shopping" CTA. See src/scrapers/aldi.ts for the rework plan.`,
    );
  }
}
