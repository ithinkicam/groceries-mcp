/**
 * Kroger deals via the official Kroger Developer API (api.kroger.com).
 *
 * Auth: OAuth2 client credentials — register at developer.kroger.com and set
 *   KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in the environment.
 * Store: set KROGER_LOCATION_ID (8-char store code); find yours with
 *   npm run find-kroger-store -- <zip>
 *
 * Strategy: search the products API for ~30 grocery terms and collect items
 * where price.promo is set and lower than price.regular. This captures the
 * store's current promotional pricing rather than the structured weekly-ad
 * page (which is not exposed by the public API).
 */
import {
  DealItem,
  DealsBucket,
  StoreDeals,
  categorize,
  isMealRelevant,
} from "../models.js";
import { Scraper } from "./base.js";

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const PRODUCTS_URL = "https://api.kroger.com/v1/products";

// Broad grocery terms that cover the categories most likely to have weekly
// promos. Each fires one API call (up to 50 results); ~30 calls total per
// scrape — well within the 10,000 calls/day limit.
const SEARCH_TERMS = [
  // Proteins
  "chicken", "beef", "pork", "salmon", "shrimp", "turkey", "steak", "tilapia",
  // Produce
  "apple", "berry", "banana", "avocado", "broccoli", "tomato",
  "salad", "grapes", "orange", "potato", "onion",
  // Dairy
  "cheese", "milk", "yogurt", "butter", "eggs",
  // Bakery
  "bread", "bagel",
  // Pantry
  "pasta", "rice", "coffee", "cereal", "soup",
  // Frozen
  "ice cream", "frozen pizza",
];

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface KrogerItem {
  itemId: string;
  size?: string;
  soldBy?: string;
  price?: {
    regular?: number;
    promo?: number;
  };
}

interface KrogerProduct {
  productId: string;
  description: string;
  brand?: string;
  categories?: string[];
  items?: KrogerItem[];
}

interface ProductsResponse {
  data?: KrogerProduct[];
}

// Module-level token cache — valid across multiple scrape calls in the same
// process; the dispatcher only creates one KrogerScraper instance.
let tokenCache: { value: string; expiresAt: number } | null = null;

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.value;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=product.compact",
  });
  if (!res.ok) {
    throw new Error(
      `Kroger OAuth2 token request failed: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  tokenCache = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

function toItem(product: KrogerProduct, krogerItem: KrogerItem): DealItem | null {
  const regular = krogerItem.price?.regular;
  const promo = krogerItem.price?.promo;
  if (!promo || !regular || promo <= 0 || promo >= regular) return null;

  const brand = product.brand ? `${product.brand} ` : "";
  const size = krogerItem.size ? ` ${krogerItem.size}` : "";
  const text = `${brand}${product.description}${size} — $${promo.toFixed(2)} (reg. $${regular.toFixed(2)})`;

  const matchSource = [
    product.description,
    product.brand ?? "",
    ...(product.categories ?? []),
  ].join(" ");

  return {
    text,
    meal_relevant: isMealRelevant(matchSource),
    category: categorize(matchSource),
    price: promo.toFixed(2),
  };
}

export class KrogerScraper implements Scraper {
  readonly name = "kroger" as const;
  readonly displayName = "Kroger";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const clientId = process.env["KROGER_CLIENT_ID"];
    const clientSecret = process.env["KROGER_CLIENT_SECRET"];
    const locationId = process.env["KROGER_LOCATION_ID"];

    if (!clientId || !clientSecret) {
      throw new Error(
        "KROGER_CLIENT_ID and KROGER_CLIENT_SECRET env vars not set. " +
          "Register at developer.kroger.com to get API credentials.",
      );
    }
    if (!locationId) {
      throw new Error(
        "KROGER_LOCATION_ID env var not set. " +
          "Find your store ID with: npm run find-kroger-store -- <zip>",
      );
    }

    const token = await fetchToken(clientId, clientSecret);

    const seen = new Set<string>();
    const deals: DealsBucket = { bogos: [], sale_items: [], other: [] };

    for (const term of SEARCH_TERMS) {
      const url = new URL(PRODUCTS_URL);
      url.searchParams.set("filter.term", term);
      url.searchParams.set("filter.locationId", locationId);
      url.searchParams.set("filter.fulfillment", "ais"); // in-store only
      url.searchParams.set("filter.limit", "50");

      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
      } catch {
        continue; // network error on one term shouldn't abort the whole scrape
      }
      if (!res.ok) continue;

      const data = (await res.json()) as ProductsResponse;
      for (const product of data.data ?? []) {
        for (const krogerItem of product.items ?? []) {
          const key = `${product.productId}:${krogerItem.itemId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const item = toItem(product, krogerItem);
          if (item) deals.sale_items.push(item);
        }
      }
    }

    return {
      store: this.displayName,
      source: PRODUCTS_URL,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}
