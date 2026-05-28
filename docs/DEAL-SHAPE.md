# Deal Shape Contract

Every scraper returns a `StoreDeals` object. The exact zod schema lives in
`src/models.ts`; this doc is the human-readable explanation.

## `StoreDeals`

```ts
{
  store: string;            // Display name, e.g. "Publix"
  source: string;           // URL the data came from
  fetched_at: string;       // ISO 8601 timestamp
  week_starting: string;    // YYYY-MM-DD, the Wednesday of the ad week
  deals: {
    bogos: DealItem[];
    sale_items: DealItem[];
    other: DealItem[];
  };
}
```

## `DealItem`

```ts
{
  text: string;             // Verbatim deal text as scraped
  meal_relevant: boolean;   // Heuristic: cooking-relevant vs. snacks/household
  category?: "protein" | "produce" | "bakery" | "dairy" | "pantry" | "frozen" | "other";
  price?: string;           // First $XX.YY found in `text`
  is_bogo?: boolean;        // Set on BOGO deals (Publix mainly)
  half_price?: string;      // For BOGO deals in half-price BOGO states (Virginia)
}
```

## Bucket meaning by store

| Store | `bogos` | `sale_items` | `other` |
|---|---|---|---|
| Publix | Real BOGOs (with `half_price` for VA) | Marked "Sale" lines | Everything else priced |
| Aldi | (empty — Aldi doesn't BOGO) | All weekly-ad items | (empty) |
| Lidl | (empty) | All current-specials items | (empty) |
| ShopRite | BOGOs detected by text heuristic | All priced promotion items | Promotion items without a parseable price |

## Why "Wednesday" for `week_starting`

Most US grocers refresh weekly ads on Wednesday or Thursday. Rounding back to
Wednesday gives a stable cache key that doesn't shift mid-week, so consecutive
scrapes during the same ad cycle hit the same cache entry.

## Empty / partial success

A scraper may legitimately return zero items — a store can have no deals in a
given week. `get_all_deals` is partial-success by design: each store either
returns a `StoreDeals` payload or a `StoreError` entry, and the request as a
whole always succeeds. Prefer it over per-store calls in batch flows so one
broken scraper doesn't block the rest.

Items with `meal_relevant === false` (snacks, household goods, etc.) are still
returned, just flagged so consumers focused on cooking ingredients can de-rank
or filter them.

---

## Price-search shapes (`search_item_prices`)

`search_item_prices` does **not** return `StoreDeals`. It returns an array of
`ItemPriceSearch`, one per input item.

### `ItemPriceSearch`

```ts
{
  query: string;          // The input search term
  zip_code: string;       // The ZIP code used to locate stores
  fetched_at: string;     // ISO 8601 timestamp of the search
  results: PriceSearchResult[];
}
```

### `PriceSearchResult`

```ts
{
  store: string;              // Store name (walmart, aldi, shoprite, lidl, publix)
  query: string;              // The input search term (same as parent query)
  matched_name: string | null; // Product name as shown on the store's site, or null if not found
  price: number | null;        // Shelf price in USD, or null if unparseable / not found
  unit_price?: string;         // Per-unit price string as shown (e.g. "$0.89 / oz")
  url?: string;                // Direct link to the product page
  error?: string;              // Set if this store/item lookup failed
}
```

`results` may contain **up to N entries per store** (N defaults to 3, controlled
by `GROCERIES_SEARCH_TOP_N`), in the store's own relevance order, so you can
compare sizes and brands and pick the best value.

A result with `matched_name: null` and no `error` means the store was searched
but returned no matching products. A result with `error` set means the scraper
failed (e.g. a bot challenge, timeout, or network error) for that store/item
combination.
