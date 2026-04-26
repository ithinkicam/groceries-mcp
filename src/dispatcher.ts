import { writeCache, readCache } from "./cache.js";
import { adWeekStarting, StoreDeals, StoreName } from "./models.js";
import { Scraper } from "./scrapers/base.js";
import { AldiScraper } from "./scrapers/aldi.js";
import { LidlScraper } from "./scrapers/lidl.js";
import { PublixScraper } from "./scrapers/publix.js";

const SCRAPERS: Record<StoreName, Scraper> = {
  publix: new PublixScraper(),
  aldi: new AldiScraper(),
  lidl: new LidlScraper(),
};

export function listStores(): StoreName[] {
  return Object.keys(SCRAPERS) as StoreName[];
}

export interface GetDealsOptions {
  store: StoreName;
  weekStarting?: string;
  forceRefresh?: boolean;
}

export async function getDeals({
  store,
  weekStarting,
  forceRefresh = false,
}: GetDealsOptions): Promise<StoreDeals> {
  const week = weekStarting ?? adWeekStarting();
  if (!forceRefresh) {
    const cached = await readCache(store, week);
    if (cached) return cached;
  }
  const scraper = SCRAPERS[store];
  const deals = await scraper.scrape(week);
  await writeCache(deals, store);
  return deals;
}
