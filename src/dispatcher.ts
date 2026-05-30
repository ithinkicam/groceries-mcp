import { writeCache, readCache } from "./cache.js";
import {
  adWeekStarting,
  DealCategory,
  DealItem,
  StoreDeals,
  StoreName,
} from "./models.js";
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

export interface FindDealsOptions {
  category?: DealCategory;
  keywords?: string[];
  stores?: StoreName[];
  mealRelevantOnly?: boolean;
  weekStarting?: string;
  forceRefresh?: boolean;
}

export interface FindDealsResult {
  filters: {
    category: DealCategory | null;
    keywords: string[] | null;
    stores: StoreName[];
    meal_relevant_only: boolean;
  };
  week_starting: string;
  by_store: Record<string, { match_count: number; items: DealItem[] }>;
  by_keyword?: Record<string, Record<string, DealItem[]>>;
  errors?: Record<string, string>;
}

function flatten(deals: StoreDeals): DealItem[] {
  return [...deals.deals.bogos, ...deals.deals.sale_items, ...deals.deals.other];
}

export async function findDealsAcrossStores(
  opts: FindDealsOptions = {},
): Promise<FindDealsResult> {
  const week = opts.weekStarting ?? adWeekStarting();
  const stores = opts.stores ?? listStores();
  const mealRelevantOnly = opts.mealRelevantOnly ?? true;

  const errors: Record<string, string> = {};
  const itemsByStore: Record<string, DealItem[]> = {};

  for (const store of stores) {
    try {
      const data = await getDeals({
        store,
        weekStarting: week,
        ...(opts.forceRefresh !== undefined ? { forceRefresh: opts.forceRefresh } : {}),
      });
      itemsByStore[store] = flatten(data);
    } catch (err) {
      errors[store] = err instanceof Error ? err.message : String(err);
    }
  }

  const matchesFilters = (item: DealItem): boolean => {
    if (mealRelevantOnly && !item.meal_relevant) return false;
    if (opts.category && item.category !== opts.category) return false;
    return true;
  };

  const matchesAnyKeyword = (text: string, keywords: string[]): boolean => {
    const hay = text.toLowerCase();
    return keywords.some((k) => hay.includes(k.toLowerCase()));
  };

  const by_store: FindDealsResult["by_store"] = {};
  for (const store of stores) {
    if (errors[store]) continue;
    const items = (itemsByStore[store] ?? [])
      .filter(matchesFilters)
      .filter((i) =>
        opts.keywords && opts.keywords.length > 0
          ? matchesAnyKeyword(i.text, opts.keywords)
          : true,
      );
    by_store[store] = { match_count: items.length, items };
  }

  let by_keyword: FindDealsResult["by_keyword"];
  if (opts.keywords && opts.keywords.length > 0) {
    by_keyword = {};
    for (const kw of opts.keywords) {
      const lc = kw.toLowerCase();
      const perStore: Record<string, DealItem[]> = {};
      for (const store of stores) {
        if (errors[store]) continue;
        perStore[store] = (itemsByStore[store] ?? [])
          .filter(matchesFilters)
          .filter((i) => i.text.toLowerCase().includes(lc));
      }
      by_keyword[kw] = perStore;
    }
  }

  return {
    filters: {
      category: opts.category ?? null,
      keywords: opts.keywords ?? null,
      stores,
      meal_relevant_only: mealRelevantOnly,
    },
    week_starting: week,
    by_store,
    ...(by_keyword !== undefined ? { by_keyword } : {}),
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}
