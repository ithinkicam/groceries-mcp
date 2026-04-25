/**
 * Aldi scraper.
 *
 * As of April 2026, aldi.us/weekly-specials/weekly-ads renders a "Shop Now"
 * CTA that links into a GraphQL-backed catalog at
 * `aldi.us/store/aldi/collections/rc-weekly-ad`. The product list is loaded
 * via a lazy-paginated `Items` GraphQL query that returns rich item data
 * including names, sizes, and prices.
 *
 * Strategy: drive the UI with Playwright, scroll to trigger all lazy
 * `Items` batches, and observe the network responses. We don't reverse the
 * GraphQL persisted-query hash — the page does the heavy lifting of
 * resolving the collection slug to a list of item IDs and batching the
 * fetches. We just listen.
 *
 * If Aldi switches the persisted-query hashes or restructures the page,
 * the scraper will still throw a clear error and the dispatcher will
 * surface it as a partial-success failure.
 */
import {
  DealItem,
  DealsBucket,
  StoreDeals,
  categorize,
  isMealRelevant,
} from "../models.js";
import { Scraper } from "./base.js";
import { getContext } from "./browser.js";

const ALDI_URL = "https://www.aldi.us/weekly-specials/weekly-ads";

interface AldiItem {
  name?: string;
  size?: string | null;
  brandName?: string | null;
  price?: {
    viewSection?: {
      itemCard?: {
        priceString?: string | null;
        fullPriceString?: string | null;
      } | null;
    } | null;
  } | null;
}

export class AldiScraper implements Scraper {
  readonly name = "aldi" as const;
  readonly displayName = "Aldi";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const ctx = await getContext();
    const page = await ctx.newPage();
    const items: AldiItem[] = [];
    const seen = new Set<string>();

    const onResponse = async (resp: import("playwright").Response) => {
      try {
        const url = resp.url();
        if (!/aldi\.us\/graphql\?operationName=Items\b/.test(url)) return;
        const text = await resp.text();
        if (text.length === 0) return;
        const data = JSON.parse(text) as {
          data?: { items?: Array<AldiItem & { id?: string }> };
        };
        const arr = data?.data?.items ?? [];
        for (const item of arr) {
          const id = item.id;
          if (id && !seen.has(id)) {
            seen.add(id);
            items.push(item);
          }
        }
      } catch {
        /* ignore individual response parse failures */
      }
    };

    page.on("response", onResponse);

    try {
      await page.goto(ALDI_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(6_000);

      const cta = page.locator('a:has-text("Shop Now")').first();
      if ((await cta.count()) === 0) {
        throw new Error(
          'No "Shop Now" CTA found on aldi.us/weekly-specials/weekly-ads. The page layout may have changed.',
        );
      }
      await cta.click({ timeout: 10_000 });
      // Initial product load.
      await page.waitForTimeout(8_000);

      // Scroll to the bottom to trigger lazy Items batches. Loop until the
      // captured count stops growing (or a hard cap).
      let lastCount = -1;
      for (let pass = 0; pass < 12; pass++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(1_200);
        if (items.length === lastCount) break;
        lastCount = items.length;
      }
    } finally {
      page.off("response", onResponse);
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }

    if (items.length === 0) {
      throw new Error(
        "Loaded the Aldi weekly-ad page but captured 0 items from the Items GraphQL query. " +
          "The persisted-query operation name or response shape may have changed.",
      );
    }

    const deals = bucketize(items);

    return {
      store: this.displayName,
      source: ALDI_URL,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}

function priceStringToNumber(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const m = /\$(\d+\.\d{2})/.exec(s);
  return m?.[1];
}

function buildText(it: AldiItem): string {
  const parts: string[] = [];
  if (it.name) parts.push(it.name);
  if (it.size) parts.push(it.size);
  const card = it.price?.viewSection?.itemCard;
  const sale = card?.priceString;
  const reg = card?.fullPriceString;
  if (sale && reg) {
    parts.push(`${sale} (was ${reg})`);
  } else if (sale) {
    parts.push(sale);
  }
  return parts.filter(Boolean).join(", ");
}

function bucketize(items: AldiItem[]): DealsBucket {
  const out: DealItem[] = [];
  for (const it of items) {
    const text = buildText(it);
    if (!text) continue;
    const card = it.price?.viewSection?.itemCard;
    const item: DealItem = {
      text,
      meal_relevant: isMealRelevant(text),
      category: categorize(text),
    };
    const price = priceStringToNumber(card?.priceString);
    if (price) item.price = price;
    out.push(item);
  }
  // Aldi doesn't BOGO; everything goes into sale_items.
  return { bogos: [], sale_items: out, other: [] };
}
