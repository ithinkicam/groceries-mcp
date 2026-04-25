/**
 * Walmart scraper — walmart.com/shop/savings/food.
 *
 * Walmart uses Akamai bot detection and frequently shows challenges to
 * headless browsers. This scraper does the polite version: a real Chromium
 * with a realistic UA, a couple of human-paced scrolls. If Akamai blocks,
 * the scrape returns an empty deal set with the source URL — the dispatcher
 * will surface this as "no deals found" rather than throwing, since this is
 * a known-flaky source.
 *
 * If you need reliable Walmart deals: the Walmart MCP server (separate
 * project) or hitting their official API with a key are better paths.
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

const WALMART_URL = "https://www.walmart.com/shop/savings/food";
const PRICE_RE = /\$(\d+\.\d{2})/;
const PRICE_RE_GLOBAL = /\$(\d+\.\d{2})/g;

export class WalmartScraper implements Scraper {
  readonly name = "walmart" as const;
  readonly displayName = "Walmart";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const ctx = await getContext();
    const page = await ctx.newPage();
    let blocked = false;
    let texts: string[] = [];
    try {
      const resp = await page.goto(WALMART_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      // Akamai challenges return 403 or a "Robot or human?" page.
      const status = resp?.status() ?? 0;
      if (status === 403 || status === 429) blocked = true;

      const title = await page.title().catch(() => "");
      if (/robot|verify|challenge/i.test(title)) blocked = true;

      if (!blocked) {
        for (let i = 0; i < 6; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(500);
        }
        texts = await page.evaluate(() => {
          const out: string[] = [];
          document
            .querySelectorAll('[data-item-id], [data-testid*="product"], li[data-testid]')
            .forEach((el) => {
              const t = (el as HTMLElement).innerText?.trim();
              if (t && t.length > 3 && t.length < 400) out.push(t);
            });
          return out;
        });
      }
    } finally {
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }

    if (blocked) {
      // Return an empty payload with a note in `other` so the consumer can see
      // it was attempted but blocked. Don't throw — this is expected with Walmart.
      return {
        store: this.displayName,
        source: WALMART_URL,
        fetched_at: new Date().toISOString(),
        week_starting: weekStarting,
        deals: {
          bogos: [],
          sale_items: [],
          other: [
            {
              text: "Walmart blocked the request (Akamai bot detection). Manual entry needed.",
              meal_relevant: false,
            },
          ],
        },
      };
    }

    const deals = parseTexts(texts);
    return {
      store: this.displayName,
      source: WALMART_URL,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}

function parseTexts(texts: string[]): DealsBucket {
  const seen = new Set<string>();
  const items: DealItem[] = [];
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!PRICE_RE.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    const item: DealItem = {
      text,
      meal_relevant: isMealRelevant(text),
      category: categorize(text),
    };
    const prices = [...text.matchAll(PRICE_RE_GLOBAL)].map((m) => m[1]);
    if (prices[0]) item.price = prices[0];
    items.push(item);
  }
  return { bogos: [], sale_items: items, other: [] };
}
