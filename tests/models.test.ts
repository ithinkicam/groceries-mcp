import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StoreDealsSchema,
  adWeekStarting,
  categorize,
  isMealRelevant,
} from "../src/models.js";

test("adWeekStarting rounds back to Wednesday", () => {
  // 2026-04-25 is a Saturday; the Wednesday before is 2026-04-22.
  assert.equal(adWeekStarting(new Date("2026-04-25T12:00:00Z")), "2026-04-22");
  // 2026-04-22 is the Wednesday itself; should return same date.
  assert.equal(adWeekStarting(new Date("2026-04-22T12:00:00Z")), "2026-04-22");
  // 2026-04-21 is Tuesday; previous Wednesday is 2026-04-15.
  assert.equal(adWeekStarting(new Date("2026-04-21T12:00:00Z")), "2026-04-15");
});

test("categorize buckets common items correctly", () => {
  assert.equal(categorize("Chicken thighs, BOGO"), "protein");
  assert.equal(categorize("Brussels sprouts, $2.99/lb"), "produce");
  assert.equal(categorize("Sargento shredded cheese"), "dairy");
  assert.equal(categorize("Rummo pasta, 1 lb"), "pantry");
  assert.equal(categorize("Edy's ice cream"), "frozen");
  assert.equal(categorize("Toilet paper"), "other");
});

test("categorize handles fruit varieties beyond the basics", () => {
  assert.equal(categorize("Black or Red Plums"), "produce");
  assert.equal(categorize("Cotton Candy Grapes"), "produce");
  assert.equal(categorize("Strawberries"), "produce");
  assert.equal(categorize("Mangos or Honey Mangos"), "produce");
  assert.equal(categorize("White Peaches"), "produce");
  assert.equal(categorize("Pineapple Spears"), "produce");
});

test("categorize identifies bakery items", () => {
  assert.equal(categorize("San Francisco style sourdough loaf"), "bakery");
  assert.equal(categorize("Specially Selected Hawaiian Brioche Bun"), "bakery");
  assert.equal(categorize("Croissants, 4 ct"), "bakery");
  assert.equal(categorize("Plain Bagels"), "bakery");
  assert.equal(categorize("GreenWise Mini Muffins"), "bakery");
  assert.equal(categorize("Italian Bread"), "bakery");
});

test("categorize routes snacks and non-food items away from produce/bakery", () => {
  // Snacks that incidentally contain produce/bakery keywords go to pantry.
  assert.equal(categorize("Lay's Potato Chips"), "pantry");
  assert.equal(categorize("Utz Family Size Potato Chips"), "pantry");
  assert.equal(categorize("Doritos tortilla chips, nacho cheese"), "pantry");
  assert.equal(categorize("Jolly Time Popcorn"), "pantry");
  assert.equal(categorize("Snyder's pretzels"), "pantry");
  // Non-food items end up as "other" even if they match a fruit/grain name.
  assert.equal(categorize("LS LIVE IN STYLE City Tote - Cherry"), "other");
  assert.equal(categorize("Belavi Solar Garden Figurine, Frog"), "other");
  assert.equal(categorize("Colgate Optic White Toothpaste"), "other");
});

test("isMealRelevant true positives + negatives", () => {
  assert.equal(isMealRelevant("Chicken breasts $4.99/lb"), true);
  assert.equal(isMealRelevant("Brussels sprouts"), true);
  assert.equal(isMealRelevant("Spinach"), true);
  assert.equal(isMealRelevant("Tide laundry detergent"), false);
  // Produce that used to fall through:
  assert.equal(isMealRelevant("Black or Red Plums"), true);
  assert.equal(isMealRelevant("Red Seedless Grapes"), true);
  assert.equal(isMealRelevant("Pineapple Spears"), true);
  // Bakery:
  assert.equal(isMealRelevant("Sourdough loaf"), true);
  assert.equal(isMealRelevant("Hawaiian Brioche Bun"), true);
});

test("StoreDealsSchema accepts a well-formed payload", () => {
  const result = StoreDealsSchema.safeParse({
    store: "Publix",
    source: "https://example.com/post",
    fetched_at: "2026-04-25T12:00:00.000Z",
    week_starting: "2026-04-22",
    deals: {
      bogos: [
        {
          text: "Chicken thighs, BOGO $5.99",
          meal_relevant: true,
          category: "protein",
          price: "5.99",
          is_bogo: true,
          half_price: "3.00",
        },
      ],
      sale_items: [],
      other: [],
    },
  });
  assert.equal(result.success, true);
});
