import { type BrowserContext } from "playwright";
import { writeCache, readCache } from "./cache.js";
import {
  adWeekStarting,
  DealCategory,
  DealItem,
  DealStoreName,
  ItemPriceSearch,
  PriceSearchResult,
  SearchStoreName,
  StoreDeals,
} from "./models.js";
import { Scraper, SearchScraper } from "./scrapers/base.js";
import { AldiScraper } from "./scrapers/aldi.js";
import { LidlScraper } from "./scrapers/lidl.js";
import { PublixScraper } from "./scrapers/publix.js";
import { ShopRiteDealsScraper } from "./scrapers/shoprite-deals.js";
import { AldiSearchScraper } from "./scrapers/aldi-search.js";
import { ShopRiteSearchScraper } from "./scrapers/shoprite.js";
import { WalmartSearchScraper } from "./scrapers/walmart.js";
import { LidlSearchScraper } from "./scrapers/lidl-search.js";
import { PublixSearchScraper } from "./scrapers/publix-search.js";
import { getStealthContext } from "./scrapers/browser.js";

const SCRAPERS: Record<DealStoreName, Scraper> = {
  publix: new PublixScraper(),
  aldi: new AldiScraper(),
  lidl: new LidlScraper(),
  shoprite: new ShopRiteDealsScraper(),
};

/** Factories for search scrapers — new instance per call (they are stateful). */
const SEARCH_SCRAPER_FACTORIES: Record<SearchStoreName, () => SearchScraper> = {
  walmart: () => new WalmartSearchScraper(),
  aldi: () => new AldiSearchScraper(),
  shoprite: () => new ShopRiteSearchScraper(),
  lidl: () => new LidlSearchScraper(),
  publix: () => new PublixSearchScraper(),
};

export function listStores(): DealStoreName[] {
  return Object.keys(SCRAPERS) as DealStoreName[];
}

export function listSearchStores(): SearchStoreName[] {
  return Object.keys(SEARCH_SCRAPER_FACTORIES) as SearchStoreName[];
}

export interface GetDealsOptions {
  store: DealStoreName;
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
  stores?: DealStoreName[];
  mealRelevantOnly?: boolean;
  weekStarting?: string;
  forceRefresh?: boolean;
}

export interface FindDealsResult {
  filters: {
    category: DealCategory | null;
    keywords: string[] | null;
    stores: DealStoreName[];
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

// ─── Item price search ────────────────────────────────────────────────────────

export interface SearchItemPricesOptions {
  items: string[];
  zipCode: string;
  /** Defaults to all search-capable stores: walmart, aldi, shoprite. */
  stores?: SearchStoreName[];
}

const DEFAULT_SEARCH_TOP_N = 3;

/**
 * Number of matches each store returns per item, from GROCERIES_SEARCH_TOP_N.
 * Defaults to 3; invalid or <1 values fall back to the default.
 */
export function searchTopN(): number {
  const raw = process.env["GROCERIES_SEARCH_TOP_N"];
  if (raw === undefined) return DEFAULT_SEARCH_TOP_N;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_SEARCH_TOP_N;
}

/**
 * Search for live shelf prices across search-capable stores.
 *
 * Results are NOT cached — shelf prices change too frequently to be useful
 * after even an hour.
 *
 * Each store runs sequentially (one stealth context per store) so browser
 * contexts don't interfere with each other. Parallel execution is straightforward
 * once the sequential path is validated — each store already gets its own context.
 */
export async function searchItemPrices(
  opts: SearchItemPricesOptions,
): Promise<ItemPriceSearch[]> {
  const { items, zipCode } = opts;
  const targetStores = opts.stores ?? listSearchStores();
  const limit = searchTopN();

  // Collect flat results as [store, item, result-or-error] tuples, then reshape.
  const flat: PriceSearchResult[] = [];

  for (const storeName of targetStores) {
    const scraper = SEARCH_SCRAPER_FACTORIES[storeName]();
    let ctx: BrowserContext | null = null;

    try {
      ctx = await getStealthContext();
      const page = await ctx.newPage();

      await scraper.setLocation(page, zipCode);

      for (const item of items) {
        try {
          const results = await scraper.search(page, item, limit);
          if (results.length === 0) {
            // Store searched but found nothing — emit a placeholder so the
            // caller can see the store was checked.
            flat.push({
              store: storeName,
              query: item,
              matched_name: null,
              price: null,
            });
          } else {
            flat.push(...results);
          }
        } catch (err) {
          flat.push({
            store: storeName,
            query: item,
            matched_name: null,
            price: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      // Store-level failure (e.g. browser crash, setLocation threw) — mark all
      // items for this store as errored.
      const msg = err instanceof Error ? err.message : String(err);
      for (const item of items) {
        flat.push({
          store: storeName,
          query: item,
          matched_name: null,
          price: null,
          error: msg,
        });
      }
    } finally {
      await ctx?.close().catch(() => {});
    }
  }

  // Reshape flat list into one ItemPriceSearch per input item.
  const fetched_at = new Date().toISOString();
  return items.map((item) => ({
    query: item,
    zip_code: zipCode,
    fetched_at,
    results: flat.filter((r) => r.query === item),
  }));
}
