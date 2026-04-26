/**
 * Publix scraper — uses iHeartPublix.com, a fan site that publishes the full
 * weekly BOGO + sale list as readable HTML.
 *
 * Strategy:
 *   1. Fetch the "sneak peek" category page.
 *   2. Find the most recent post URL matching the weekly-ad slug pattern.
 *   3. Fetch that post; strip script/style; treat lines containing "$XX.YY" as deals.
 *   4. Bucket into BOGOs / sale items based on section headers.
 *
 * Virginia is a half-price BOGO state, so for BOGO items we also compute
 * the effective single-unit price (price / 2).
 */
import {
  DealItem,
  DealsBucket,
  StoreDeals,
  categorize,
  isMealRelevant,
} from "../models.js";
import { Scraper } from "./base.js";

const SNEAK_PEEK_URL = "https://www.iheartpublix.com/category/sneak-peek/";
const POST_URL_PATTERN =
  /href="(https:\/\/www\.iheartpublix\.com\/\d{4}\/\d{2}\/publix-ad-coupons-week-of-[^"]+)"/;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml",
};

async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function findCurrentPostUrl(): Promise<string | null> {
  const html = await fetchText(SNEAK_PEEK_URL);
  const match = POST_URL_PATTERN.exec(html);
  return match?.[1] ?? null;
}

/**
 * Strip <script>/<style> blocks and tags, returning a newline-separated stream
 * of visible text — same shape the Python HTMLParser produced.
 */
function extractText(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Insert newlines at common block-level boundaries so list items stay separate.
  const broken = stripped
    .replace(/<\/?(?:br|p|li|div|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”");
  return broken
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

const PRICE_RE = /\$(\d+\.\d{2})/;
const PRICE_RE_GLOBAL = /\$(\d+\.\d{2})/g;

function parseDeals(text: string): DealsBucket {
  const lines = text.split("\n");
  const deals: DealsBucket = { bogos: [], sale_items: [], other: [] };
  let section: "bogos" | "sale_items" | "other" = "other";

  for (const raw of lines) {
    const line = raw.trim();
    const upper = line.toUpperCase();

    if (upper === "BOGOS" || (upper.includes("BOGO") && line.length < 20)) {
      section = "bogos";
      continue;
    }
    if (upper.includes("SALE") && line.length < 30) {
      section = "sale_items";
      continue;
    }

    if (!PRICE_RE.test(line) || line.length <= 10) continue;

    const dealText = line;
    const meal_relevant = isMealRelevant(dealText);
    const item: DealItem = {
      text: dealText,
      meal_relevant,
      category: categorize(dealText),
    };

    const prices = [...dealText.matchAll(PRICE_RE_GLOBAL)].map((m) => m[1]);
    if (prices[0]) item.price = prices[0];

    if (upper.includes("BOGO")) {
      item.is_bogo = true;
      if (item.price) {
        const half = parseFloat(item.price) / 2;
        if (Number.isFinite(half)) item.half_price = half.toFixed(2);
      }
      deals.bogos.push(item);
    } else {
      deals[section].push(item);
    }
  }

  return deals;
}

export class PublixScraper implements Scraper {
  readonly name = "publix" as const;
  readonly displayName = "Publix";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const postUrl = await findCurrentPostUrl();
    if (!postUrl) {
      throw new Error(
        "Could not find a current Publix sneak-peek post on iheartpublix.com. The site layout may have changed.",
      );
    }
    const html = await fetchText(postUrl);
    const text = extractText(html);
    const deals = parseDeals(text);

    return {
      store: this.displayName,
      source: postUrl,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}
