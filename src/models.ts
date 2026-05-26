import { z } from "zod";

/** All known stores. */
export const StoreNameSchema = z.enum([
  "publix",
  "aldi",
  "lidl",
  "walmart",
  "shoprite",
]);
export type StoreName = z.infer<typeof StoreNameSchema>;

/** Stores that have a weekly-deal scraper. */
export const DealStoreNameSchema = z.enum(["publix", "aldi", "lidl", "shoprite"]);
export type DealStoreName = z.infer<typeof DealStoreNameSchema>;

/** Stores that support live per-item price search. */
export const SearchStoreNameSchema = z.enum(["walmart", "aldi", "shoprite", "lidl", "publix"]);
export type SearchStoreName = z.infer<typeof SearchStoreNameSchema>;

export const STORE_DISPLAY_NAMES: Record<StoreName, string> = {
  publix: "Publix",
  aldi: "Aldi",
  lidl: "Lidl",
  walmart: "Walmart",
  shoprite: "ShopRite",
};

export const DealCategorySchema = z.enum([
  "protein",
  "produce",
  "bakery",
  "dairy",
  "pantry",
  "frozen",
  "other",
]);
export type DealCategory = z.infer<typeof DealCategorySchema>;

const DealItemSchema = z.object({
  text: z.string(),
  /** True if the item appears cooking-relevant (vs. snacks, household, etc.). */
  meal_relevant: z.boolean(),
  category: DealCategorySchema.optional(),
  /** First dollar amount found in the text (e.g. "5.15"). */
  price: z.string().optional(),
  is_bogo: z.boolean().optional(),
  /**
   * For BOGO items in half-price BOGO states (Virginia), the effective price
   * for buying a single unit. Computed as price / 2.
   */
  half_price: z.string().optional(),
});
export type DealItem = z.infer<typeof DealItemSchema>;

const DealsBucketSchema = z.object({
  bogos: z.array(DealItemSchema),
  sale_items: z.array(DealItemSchema),
  other: z.array(DealItemSchema),
});
export type DealsBucket = z.infer<typeof DealsBucketSchema>;

export const StoreDealsSchema = z.object({
  store: z.string(),
  source: z.string().describe("URL the data came from."),
  fetched_at: z.string().describe("ISO 8601 timestamp of when this snapshot was scraped."),
  /** Wednesday of the ad week this snapshot represents (YYYY-MM-DD). */
  week_starting: z.string(),
  deals: DealsBucketSchema,
});
export type StoreDeals = z.infer<typeof StoreDealsSchema>;

const StoreErrorSchema = z.object({
  store: z.string(),
  error: z.string(),
  fetched_at: z.string(),
});
export type StoreError = z.infer<typeof StoreErrorSchema>;

const AllDealsResultSchema = z.object({
  week_starting: z.string(),
  results: z.record(z.string(), z.union([StoreDealsSchema, StoreErrorSchema])),
});
export type AllDealsResult = z.infer<typeof AllDealsResultSchema>;

// ─── Price-search models ──────────────────────────────────────────────────────

/** One store's result for a single search query. */
const PriceSearchResultSchema = z.object({
  store: z.string(),
  query: z.string(),
  matched_name: z.string().nullable(),
  price: z.number().nullable(),
  /** Per-unit price string as shown by the retailer (e.g. "$0.89 / oz"). */
  unit_price: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
});
export type PriceSearchResult = z.infer<typeof PriceSearchResultSchema>;

/** All store results for a single search query. */
const ItemPriceSearchSchema = z.object({
  query: z.string(),
  zip_code: z.string(),
  fetched_at: z.string(),
  results: z.array(PriceSearchResultSchema),
});
export type ItemPriceSearch = z.infer<typeof ItemPriceSearchSchema>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the Wednesday of the ad week containing `date`.
 * Most US grocers refresh weekly ads on Wednesday or Thursday;
 * Wednesday is a safe rounding boundary.
 */
export function adWeekStarting(date = new Date()): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // 0=Sun .. 3=Wed .. 6=Sat. Move back to most recent Wed.
  const day = d.getUTCDay();
  const offsetToWed = (day - 3 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - offsetToWed);
  return d.toISOString().slice(0, 10);
}

export const MEAL_RELEVANT_KEYWORDS = [
  // Proteins
  "chicken", "beef", "pork", "steak", "turkey", "salmon", "shrimp", "seafood",
  "fish", "tilapia", "cod", "tuna", "sausage", "bacon", "ground", "tenderloin",
  "ribeye", "sirloin", "filet", "lamb", "guanciale", "pancetta", "prosciutto",
  // Produce
  "apple", "orange", "banana", "tomato", "onion", "potato", "lettuce",
  "spinach", "salad", "pepper", "avocado", "berry", "berries", "lemon",
  "lime", "garlic", "celery", "carrot", "broccoli", "mushroom", "cabbage",
  "kale", "asparagus", "zucchini", "squash", "cucumber", "ginger", "herbs",
  "brussels", "sprout",
  "cilantro", "parsley", "basil", "scallion", "leek", "shallot",
  "plum", "grape", "peach", "pear", "mango", "pineapple", "cherry", "cherries",
  "kiwi", "melon", "watermelon", "cantaloupe", "honeydew", "nectarine",
  "fig", "papaya", "tangerine", "clementine", "grapefruit", "coconut",
  "olive", "eggplant", "beet", "radish", "fennel", "artichoke", "romaine",
  "arugula", "sweet potato", "pomegranate", "persimmon", "okra", "cauliflower",
  "green bean",
  // Bakery products / sweets that double as meal-planning targets
  "cake", "pie",
  // Dairy
  "cheese", "milk", "yogurt", "butter", "cream", "egg", "ricotta", "mozzarella",
  "parmesan", "pecorino", "feta",
  // Bakery
  "bread", "loaf", "baguette", "ciabatta", "sourdough", "focaccia",
  "croissant", "brioche", "bagel", "biscuit", "muffin", "scone", "roll", "bun",
  "pita", "naan", "tortilla",
  // Pantry / cooking
  "pasta", "sauce", "rice", "olive oil", "flour", "sugar", "honey",
  "vinegar", "broth", "stock", "bean", "lentil", "chickpea", "mayonnaise",
  "mustard", "cereal", "oatmeal", "coffee", "tea", "noodle",
  // Frozen meal components
  "pizza", "frozen", "wontons", "dumplings", "edamame",
];

export function categorize(text: string): DealCategory {
  const t = text.toLowerCase();
  // Bag snacks share keywords with produce/bakery ("potato chips" matches
  // "potato", "tortilla chips" matches "tortilla"). Route them to pantry so
  // the produce/bakery categories aren't polluted with snack noise.
  if (/\b(chips|pretzels?|popcorn)\b/.test(t)) {
    return "pantry";
  }
  // Non-food items occasionally appear (Aldi sells totes, garden figurines,
  // bath/cleaning supplies). They may incidentally contain a fruit or grain
  // name — keep them out of food categories.
  if (
    /\b(tote|figurine|stake|candle|toothpaste|lotion|detergent|towel|napkin|shampoo)\b/.test(
      t,
    )
  ) {
    return "other";
  }
  if (/(chicken|beef|pork|steak|turkey|salmon|shrimp|fish|sausage|bacon|tenderloin|ground|lamb|tuna|cod|tilapia|seafood|guanciale|pancetta|prosciutto)/.test(t)) {
    return "protein";
  }
  if (/(apple|orange|banana|tomato|onion|potato|lettuce|spinach|pepper|avocado|berr(y|ies)|lemon|lime|garlic|celery|carrot|broccoli|mushroom|cabbage|kale|asparagus|zucchini|squash|cucumber|salad|herb|cilantro|parsley|basil|scallion|leek|shallot|ginger|brussels|sprout|plum|grape|peach|pear|mango|pineapple|cherr(y|ies)|kiwi|melon|nectarine|fig|papaya|tangerine|clementine|grapefruit|eggplant|beet|radish|fennel|artichoke|romaine|arugula|pomegranate|persimmon|okra|cauliflower|green bean)/.test(t)) {
    return "produce";
  }
  if (/(frozen|pizza|wontons|dumplings|edamame|ice cream|ice-cream|sorbet|gelato)/.test(t)) {
    return "frozen";
  }
  if (/(croissant|baguette|ciabatta|sourdough|focaccia|brioche|bagel|biscuit|muffin|scone|pita|naan|loaf|bakery|cinnamon roll|hawaiian roll|dinner roll|kaiser roll|hoagie roll|sub roll|hot dog bun|hamburger bun|sandwich bun|breadstick|english muffin|tortilla|bread)/.test(t)) {
    return "bakery";
  }
  if (/(cheese|milk|yogurt|butter|cream|egg|ricotta|mozzarella|parmesan|pecorino|feta)/.test(t)) {
    return "dairy";
  }
  if (/(pasta|sauce|rice|olive oil|flour|sugar|honey|vinegar|broth|stock|bean|lentil|chickpea|mayonnaise|mustard|cereal|oatmeal|coffee|tea|noodle|spice|seasoning)/.test(t)) {
    return "pantry";
  }
  return "other";
}

export function isMealRelevant(text: string): boolean {
  const t = text.toLowerCase();
  return MEAL_RELEVANT_KEYWORDS.some((kw) => t.includes(kw));
}
