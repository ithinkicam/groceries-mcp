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
