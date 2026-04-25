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
  category?: "protein" | "produce" | "dairy" | "pantry" | "frozen" | "other";
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
| Walmart | (empty) | Items found on shop/savings/food | Block markers if Akamai blocked |

## Why "Wednesday" for `week_starting`

Most US grocers refresh weekly ads on Wednesday or Thursday. Rounding back to
Wednesday gives a stable cache key that doesn't shift mid-week, so consecutive
scrapes during the same ad cycle hit the same cache entry.

## What the consumer should do

The meal-planner skill flattens these buckets into a working list of ~30–40
top deals (proteins, produce, dairy, pantry) and discards items where
`meal_relevant === false`. It uses `category` for a coarse first pass and
falls back to keyword matching on `text` for anything ambiguous.

`is_bogo` + `half_price` on Publix items powers the
"in Virginia, you only have to buy one" callout in the shopping list.

## Empty / partial success

A scraper may legitimately return zero items — a store can have no deals one
week, or anti-bot may have blocked. Consumers should:

- Check `deals.other` for explanatory markers (Walmart's Akamai block goes
  here) before treating "no items" as a hard failure.
- Treat `meal_relevant === false` items as low-priority but still render-able.
