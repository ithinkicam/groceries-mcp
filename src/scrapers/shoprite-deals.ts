/**
 * ShopRite weekly deals.
 *
 * ShopRite's "Weekly Circular" page is an image-based flipbook (not scrapable),
 * but the "Promotions / On Sale Now" page renders the same structured product
 * cards as search results (`article[data-testid^="ProductCardWrapper-"]`), with
 * sale prices. We scrape that.
 *
 * The promotions URL is store-scoped by RSID: /sm/pickup/rsid/<rsid>/promotions.
 * Set SHOPRITE_RSID to target a specific store; defaults to 3000 (a valid store
 * that serves the NY/NJ circular). Find a store's RSID by running the ShopRite
 * search scraper's setLocation flow for a ZIP, or from the store URL.
 */
import { type Page } from "playwright";
import {
  DealItem,
  DealsBucket,
  StoreDeals,
  categorize,
  isMealRelevant,
} from "../models.js";
import { Scraper } from "./base.js";
import { getContext } from "./browser.js";
import { dismissOverlays } from "./shoprite-common.js";

const PRICE_RE = /\$?([\d,]+\.?\d*)/;
const BOGO_RE = /\b(bogo|buy\s*1\s*get\s*1|buy\s*one\s*get\s*one)\b/i;

interface RawCard {
  testId: string;
  name: string | null;
  shelf_price: string | null;
  unit_price: string | null;
  full_text: string;
}

export class ShopRiteDealsScraper implements Scraper {
  readonly name = "shoprite" as const;
  readonly displayName = "ShopRite";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const rsid = process.env["SHOPRITE_RSID"] ?? "3000";
    const url = `https://www.shoprite.com/sm/pickup/rsid/${rsid}/promotions`;

    const ctx = await getContext();
    const page = await ctx.newPage();
    const byTestId = new Map<string, RawCard>();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await dismissOverlays(page);

      try {
        await page.waitForSelector('article[data-testid^="ProductCardWrapper-"]', {
          timeout: 20_000,
        });
      } catch {
        throw new Error(
          `No promotion cards on ${url}. The RSID may be invalid or the page layout changed.`,
        );
      }

      // The grid is virtualized inside an app-shell (body scrollHeight ~0) and
      // doesn't page through reliably via window scrolling, so this captures the
      // first batch (~30) of promoted items rather than the full circular. Good
      // enough for a representative sample; full coverage would need the
      // Wakefern hydration API. Scroll-and-collect anyway, deduping by
      // data-testid, in case the layout ever serves more without virtualizing.
      let lastSize = -1;
      for (let pass = 0; pass < 25; pass++) {
        const cards = await extractCards(page);
        for (const c of cards) byTestId.set(c.testId, c);

        if (byTestId.size === lastSize) break;
        lastSize = byTestId.size;

        await page.evaluate(() => window.scrollBy(0, 1600));
        await page.waitForTimeout(1_000);
      }
    } finally {
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }

    if (byTestId.size === 0) {
      throw new Error(`Loaded ${url} but extracted 0 promotion items.`);
    }

    const deals = bucketize([...byTestId.values()]);
    return {
      store: this.displayName,
      source: url,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}

async function extractCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const out: Array<{
      testId: string;
      name: string | null;
      shelf_price: string | null;
      unit_price: string | null;
      full_text: string;
    }> = [];
    const cards = Array.from(
      document.querySelectorAll('article[data-testid^="ProductCardWrapper-"]'),
    );
    for (const card of cards) {
      const testId = card.getAttribute("data-testid") ?? "";
      if (!testId) continue;

      // Name: the <p> whose text is only the product name (no "$" price).
      const pEls = Array.from(card.querySelectorAll("p"));
      const nameEl =
        pEls.find((p) => p.textContent?.trim() && !p.textContent.includes("$")) ??
        pEls.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ??
        null;

      const priceEls = Array.from(
        card.querySelectorAll('[data-testid^="productCardPricing-div-testId"]'),
      );
      out.push({
        testId,
        name: nameEl?.textContent?.trim() ?? null,
        shelf_price: priceEls[0]?.textContent?.trim() ?? null,
        unit_price: priceEls[1]?.textContent?.trim() ?? null,
        full_text: (card as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "",
      });
    }
    return out;
  });
}

function parseDollar(text: string | null): string | undefined {
  if (!text) return undefined;
  const m = PRICE_RE.exec(text.replace(/,/g, ""));
  return m?.[1];
}

function toItem(card: RawCard): DealItem {
  const name = card.name ?? "";
  const priceStr = parseDollar(card.shelf_price);
  const text =
    `${name}` +
    (card.shelf_price ? ` — ${card.shelf_price.replace(/\s+/g, " ").trim()}` : "") +
    (card.unit_price ? ` (${card.unit_price.replace(/\s+/g, " ").trim()})` : "");

  const item: DealItem = {
    text,
    meal_relevant: isMealRelevant(name),
    category: categorize(name),
  };
  if (priceStr) item.price = priceStr;
  if (BOGO_RE.test(card.full_text)) item.is_bogo = true;
  return item;
}

function bucketize(cards: RawCard[]): DealsBucket {
  const out: DealsBucket = { bogos: [], sale_items: [], other: [] };
  for (const card of cards) {
    if (!card.name) continue;
    const item = toItem(card);
    if (item.is_bogo) out.bogos.push(item);
    else if (item.price) out.sale_items.push(item);
    else out.other.push(item);
  }
  return out;
}
