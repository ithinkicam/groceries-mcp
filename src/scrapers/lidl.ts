/**
 * Lidl scraper — the "current specials" page lists all this-week items
 * with name + price as visible text. We render the page in Playwright,
 * scroll to load lazy items, then extract product cards via a stable selector.
 *
 * Lidl restructures its DOM occasionally, so we use a couple of fallback
 * selectors and the resulting list is filtered to lines with prices.
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

const LIDL_URL = "https://www.lidl.com/specials?category=all-current";

const PRICE_RE = /\$(\d+\.\d{2})/;
const PRICE_RE_GLOBAL = /\$(\d+\.\d{2})/g;

export class LidlScraper implements Scraper {
  readonly name = "lidl" as const;
  readonly displayName = "Lidl";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const ctx = await getContext();
    const page = await ctx.newPage();
    let texts: string[] = [];
    try {
      await page.goto(LIDL_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      // Lazy-loaded product grid — scroll a few times.
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(400);
      }
      // Pull every card-shaped block on the page; let the price filter narrow it.
      texts = await page.evaluate(() => {
        const out: string[] = [];
        const candidates = document.querySelectorAll(
          'article, [class*="product"], [class*="card"], [class*="tile"]',
        );
        candidates.forEach((el) => {
          const t = (el as HTMLElement).innerText?.trim();
          if (t && t.length > 3 && t.length < 400) out.push(t);
        });
        return out;
      });
    } finally {
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }

    const deals = parseTexts(texts);

    return {
      store: this.displayName,
      source: LIDL_URL,
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
