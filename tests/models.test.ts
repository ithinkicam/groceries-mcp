import { expect, test } from "vitest";
import {
  StoreDealsSchema,
  adWeekStarting,
  categorize,
  isMealRelevant,
} from "../src/models.js";

test("adWeekStarting rounds back to Wednesday", () => {
  // 2026-04-25 is a Saturday; the Wednesday before is 2026-04-22.
  expect(adWeekStarting(new Date("2026-04-25T12:00:00Z"))).toBe("2026-04-22");
  // 2026-04-22 is the Wednesday itself; should return same date.
  expect(adWeekStarting(new Date("2026-04-22T12:00:00Z"))).toBe("2026-04-22");
  // 2026-04-21 is Tuesday; previous Wednesday is 2026-04-15.
  expect(adWeekStarting(new Date("2026-04-21T12:00:00Z"))).toBe("2026-04-15");
});

test("categorize buckets common items correctly", () => {
  expect(categorize("Chicken thighs, BOGO")).toBe("protein");
  expect(categorize("Brussels sprouts, $2.99/lb")).toBe("produce");
  expect(categorize("Sargento shredded cheese")).toBe("dairy");
  expect(categorize("Rummo pasta, 1 lb")).toBe("pantry");
  expect(categorize("Edy's ice cream")).toBe("frozen");
  expect(categorize("Toilet paper")).toBe("other");
});

test("categorize handles fruit varieties beyond the basics", () => {
  expect(categorize("Black or Red Plums")).toBe("produce");
  expect(categorize("Cotton Candy Grapes")).toBe("produce");
  expect(categorize("Strawberries")).toBe("produce");
  expect(categorize("Mangos or Honey Mangos")).toBe("produce");
  expect(categorize("White Peaches")).toBe("produce");
  expect(categorize("Pineapple Spears")).toBe("produce");
});

test("categorize identifies bakery items", () => {
  expect(categorize("San Francisco style sourdough loaf")).toBe("bakery");
  expect(categorize("Specially Selected Hawaiian Brioche Bun")).toBe("bakery");
  expect(categorize("Croissants, 4 ct")).toBe("bakery");
  expect(categorize("Plain Bagels")).toBe("bakery");
  expect(categorize("GreenWise Mini Muffins")).toBe("bakery");
  expect(categorize("Italian Bread")).toBe("bakery");
});

test("categorize routes snacks and non-food items away from produce/bakery", () => {
  // Snacks that incidentally contain produce/bakery keywords go to pantry.
  expect(categorize("Lay's Potato Chips")).toBe("pantry");
  expect(categorize("Utz Family Size Potato Chips")).toBe("pantry");
  expect(categorize("Doritos tortilla chips, nacho cheese")).toBe("pantry");
  expect(categorize("Jolly Time Popcorn")).toBe("pantry");
  expect(categorize("Snyder's pretzels")).toBe("pantry");
  // Non-food items end up as "other" even if they match a fruit/grain name.
  expect(categorize("LS LIVE IN STYLE City Tote - Cherry")).toBe("other");
  expect(categorize("Belavi Solar Garden Figurine, Frog")).toBe("other");
  expect(categorize("Colgate Optic White Toothpaste")).toBe("other");
});

test("isMealRelevant true positives + negatives", () => {
  expect(isMealRelevant("Chicken breasts $4.99/lb")).toBe(true);
  expect(isMealRelevant("Brussels sprouts")).toBe(true);
  expect(isMealRelevant("Spinach")).toBe(true);
  expect(isMealRelevant("Tide laundry detergent")).toBe(false);
  // Produce that used to fall through:
  expect(isMealRelevant("Black or Red Plums")).toBe(true);
  expect(isMealRelevant("Red Seedless Grapes")).toBe(true);
  expect(isMealRelevant("Pineapple Spears")).toBe(true);
  // Bakery:
  expect(isMealRelevant("Sourdough loaf")).toBe(true);
  expect(isMealRelevant("Hawaiian Brioche Bun")).toBe(true);
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
  expect(result.success).toBe(true);
});
