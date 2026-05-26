/**
 * Lidl live item-price search scraper.
 *
 * Distinct from `lidl.ts` (which scrapes the weekly /specials page). Lidl US
 * prices ARE store-specific: lidl.com's search page is backed by a JSON API
 * (mobileapi.lidl.com) that takes a storeId. We hit that API directly:
 *
 *   1. setLocation: GET /v1/stores?zip=<zip>  -> nearest store's `id` (storeId)
 *   2. search:      GET /v1/search/products?q=<item>&storeId=<id>&numResults=N
 *
 * The API needs no auth — only browser-like origin/referer headers — and we
 * issue it through the page's request context (browser TLS + cookies).
 */
import { type Page } from "playwright";
import { PriceSearchResult } from "../models.js";
import { SearchScraper } from "./base.js";

const API = "https://mobileapi.lidl.com/v1";
// Fallback store if a ZIP lookup fails, so search still returns something.
const DEFAULT_STORE_ID = "US01053";
const API_HEADERS = {
  origin: "https://www.lidl.com",
  referer: "https://www.lidl.com/",
  accept: "*/*",
};

interface LidlPrice {
  currentPrice?: { value?: number; currency?: string; basePriceText?: string };
}
interface LidlProduct {
  id?: string;
  name?: string;
  priceInformation?: {
    currentPrice?: LidlPrice;
    promotionPrice?: LidlPrice | null;
  };
}

export class LidlSearchScraper implements SearchScraper {
  readonly name = "lidl";
  readonly displayName = "Lidl";

  private storeId: string | null = null;

  async setLocation(page: Page, zipCode: string): Promise<void> {
    try {
      const res = await page.request.get(
        `${API}/stores?zip=${encodeURIComponent(zipCode)}`,
        { headers: API_HEADERS, timeout: 20_000 },
      );
      if (res.ok()) {
        const json = (await res.json()) as { results?: Array<{ id?: string }> };
        this.storeId = json.results?.[0]?.id ?? null;
      }
    } catch {
      /* best-effort — search() falls back to a default store */
    }
  }

  async search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]> {
    const storeId = this.storeId ?? DEFAULT_STORE_ID;
    const url =
      `${API}/search/products?numResults=${limit}` +
      `&q=${encodeURIComponent(item)}&storeId=${encodeURIComponent(storeId)}`;

    const res = await page.request.get(url, { headers: API_HEADERS, timeout: 20_000 });
    if (!res.ok()) return [];

    const json = (await res.json()) as { results?: LidlProduct[] };
    const products = (json.results ?? []).slice(0, limit);

    return products.map((p) => {
      // Prefer the promo price when present, else the current price.
      const cur =
        p.priceInformation?.promotionPrice?.currentPrice ??
        p.priceInformation?.currentPrice?.currentPrice;
      const price = typeof cur?.value === "number" ? cur.value : null;
      const unit = cur?.basePriceText?.replace(/\s+/g, " ").trim();
      return {
        store: this.name,
        query: item,
        matched_name: p.name ?? null,
        price,
        ...(unit ? { unit_price: unit } : {}),
        url: p.id ? `https://www.lidl.com/products/${p.id}` : url,
      };
    });
  }
}
