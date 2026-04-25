/**
 * Normalized data shapes returned by all scrapers, defined as zod schemas
 * so the MCP tool layer can advertise them as outputSchemas to clients.
 *
 * The shape is deliberately the same as what the legacy Python scrapers
 * produced, so the meal-planner skill that consumes this can stay unchanged.
 */
import { z } from "zod";

export const StoreNameSchema = z.enum([
  "publix",
  "aldi",
  "lidl",
  "walmart",
]);
export type StoreName = z.infer<typeof StoreNameSchema>;

export const STORE_DISPLAY_NAMES: Record<StoreName, string> = {
  publix: "Publix",
  aldi: "Aldi",
  lidl: "Lidl",
  walmart: "Walmart",
};

export const DealCategorySchema = z.enum([
  "protein",
  "produce",
  "dairy",
  "pantry",
  "frozen",
  "other",
]);
export type DealCategory = z.infer<typeof DealCategorySchema>;

/** A single sale item in a normalized form. */
export const DealItemSchema = z.object({
  /** Raw deal text as scraped, kept verbatim for human review. */
  text: z.string(),
  /** True if the item appears cooking-relevant (vs. snacks, household, etc.). */
  meal_relevant: z.boolean(),
  /** Coarse category — best-effort, may be 'other'. */
  category: DealCategorySchema.optional(),
  /** First dollar amount found in the text (e.g. "5.15"). */
  price: z.string().optional(),
  /** True if the item is on a BOGO sale. */
  is_bogo: z.boolean().optional(),
  /**
   * For BOGO items in half-price BOGO states (Virginia), the effective price
   * for buying a single unit. Computed as price / 2.
   */
  half_price: z.string().optional(),
});
export type DealItem = z.infer<typeof DealItemSchema>;

export const DealsBucketSchema = z.object({
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

/**
 * Returned by get_all_deals. Failures don't poison the whole batch: a store
 * either has data or has an error, and successful stores are still returned.
 */
export const StoreErrorSchema = z.object({
  store: z.string(),
  error: z.string(),
  fetched_at: z.string(),
});
export type StoreError = z.infer<typeof StoreErrorSchema>;

export const AllDealsResultSchema = z.object({
  week_starting: z.string(),
  results: z.record(z.string(), z.union([StoreDealsSchema, StoreErrorSchema])),
});
export type AllDealsResult = z.infer<typeof AllDealsResultSchema>;

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

/** Default keyword set used by scrapers to flag meal-relevant items. */
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
  // Dairy
  "cheese", "milk", "yogurt", "butter", "cream", "egg", "ricotta", "mozzarella",
  "parmesan", "pecorino", "feta",
  // Pantry / cooking
  "pasta", "sauce", "rice", "olive oil", "bread", "flour", "sugar", "honey",
  "vinegar", "broth", "stock", "bean", "lentil", "chickpea", "mayonnaise",
  "mustard", "cereal", "oatmeal", "coffee", "tea", "noodle", "tortilla",
  // Frozen meal components
  "pizza", "frozen", "wontons", "dumplings", "edamame", "shrimp",
];

/** Categorize a deal text into a coarse bucket. */
export function categorize(text: string): DealCategory {
  const t = text.toLowerCase();
  if (/(chicken|beef|pork|steak|turkey|salmon|shrimp|fish|sausage|bacon|tenderloin|ground|lamb|tuna|cod|tilapia|seafood|guanciale|pancetta|prosciutto)/.test(t)) {
    return "protein";
  }
  if (/(apple|orange|banana|tomato|onion|potato|lettuce|spinach|pepper|avocado|berry|lemon|lime|garlic|celery|carrot|broccoli|mushroom|cabbage|kale|asparagus|zucchini|squash|cucumber|salad|herb|cilantro|parsley|basil|scallion|leek|shallot|ginger|brussels|sprout)/.test(t)) {
    return "produce";
  }
  if (/(frozen|pizza|wontons|dumplings|edamame|ice cream|ice-cream|sorbet|gelato)/.test(t)) {
    return "frozen";
  }
  if (/(cheese|milk|yogurt|butter|cream|egg|ricotta|mozzarella|parmesan|pecorino|feta)/.test(t)) {
    return "dairy";
  }
  if (/(pasta|sauce|rice|olive oil|bread|flour|sugar|honey|vinegar|broth|stock|bean|lentil|chickpea|mayonnaise|mustard|cereal|oatmeal|coffee|tea|noodle|tortilla|spice|seasoning)/.test(t)) {
    return "pantry";
  }
  return "other";
}

export function isMealRelevant(text: string): boolean {
  const t = text.toLowerCase();
  return MEAL_RELEVANT_KEYWORDS.some((kw) => t.includes(kw));
}
