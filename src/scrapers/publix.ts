/**
 * Source: services.publix.com/api/v4/savings, the same endpoint publix.com's
 * weekly-ad page hits. The only auth is a `publixstore: <id>` header naming
 * which store's ad to return — find your ID with `npm run find-publix-store`.
 *
 * Virginia is a half-price BOGO state, so for BOGO items we also compute the
 * effective single-unit price (price / 2).
 */
import {
  DealItem,
  DealsBucket,
  StoreDeals,
  categorize,
  isMealRelevant,
} from "../models.js";
import { Scraper } from "./base.js";

const SAVINGS_URL =
  "https://services.publix.com/api/v4/savings" +
  "?smImg=235&enImg=368&fallbackImg=false&isMobile=false" +
  "&page=1&pageSize=0&includePersonalizedDeals=false" +
  "&languageID=1&isWeb=true&getSavingType=WeeklyAd";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface Saving {
  savings: string;
  title: string;
  description?: string;
  additionalDealInfo?: string | null;
}

interface SavingsResponse {
  Savings?: Saving[];
}

const PRICE_RE = /\$(\d+\.\d{2})/;

function toItem(s: Saving): DealItem {
  const matchSource = `${s.title} ${s.description ?? ""}`;
  const text =
    `${s.title} — ${s.savings}` +
    (s.additionalDealInfo ? ` (${s.additionalDealInfo})` : "");
  const item: DealItem = {
    text,
    meal_relevant: isMealRelevant(matchSource),
    category: categorize(matchSource),
  };

  if (/Buy 1 Get 1 FREE/i.test(s.savings)) {
    item.is_bogo = true;
    // additionalDealInfo on a BOGO is "SAVE UP TO $X.XX" — the regular price
    // of one unit. In half-price BOGO states (Virginia), that doubles as the
    // basis for the half-price (price / 2).
    const m = s.additionalDealInfo ? PRICE_RE.exec(s.additionalDealInfo) : null;
    if (m?.[1]) {
      item.price = m[1];
      const half = parseFloat(m[1]) / 2;
      if (Number.isFinite(half)) item.half_price = half.toFixed(2);
    }
  } else {
    const m = PRICE_RE.exec(s.savings);
    if (m?.[1]) item.price = m[1];
  }

  return item;
}

function bucketize(savings: Saving[]): DealsBucket {
  const out: DealsBucket = { bogos: [], sale_items: [], other: [] };
  for (const s of savings) {
    const item = toItem(s);
    if (item.is_bogo) out.bogos.push(item);
    else if (item.price) out.sale_items.push(item);
    else out.other.push(item);
  }
  return out;
}

export class PublixScraper implements Scraper {
  readonly name = "publix" as const;
  readonly displayName = "Publix";

  async scrape(weekStarting: string): Promise<StoreDeals> {
    const storeId = process.env["PUBLIX_STORE_ID"];
    if (!storeId) {
      throw new Error(
        "PUBLIX_STORE_ID env var not set. Find your store ID with: " +
          "npm run find-publix-store -- <zip>",
      );
    }
    const res = await fetch(SAVINGS_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        publixstore: storeId,
      },
    });
    if (!res.ok) {
      throw new Error(`Publix savings API returned ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as SavingsResponse;
    const deals = bucketize(data.Savings ?? []);
    return {
      store: this.displayName,
      source: SAVINGS_URL,
      fetched_at: new Date().toISOString(),
      week_starting: weekStarting,
      deals,
    };
  }
}
