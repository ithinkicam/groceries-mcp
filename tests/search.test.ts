import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  findDealsAcrossStores,
  listSearchStores,
  searchTopN,
} from "../src/dispatcher.js";
import type { DealCategory, DealStoreName, StoreDeals } from "../src/models.js";

// ─── searchTopN ──────────────────────────────────────────────────────────────

test("searchTopN env-var parsing", () => {
  const saved = process.env["GROCERIES_SEARCH_TOP_N"];
  try {
    delete process.env["GROCERIES_SEARCH_TOP_N"];
    assert.equal(searchTopN(), 3, "default when unset");

    process.env["GROCERIES_SEARCH_TOP_N"] = "5";
    assert.equal(searchTopN(), 5, "parses positive integers");

    process.env["GROCERIES_SEARCH_TOP_N"] = "1";
    assert.equal(searchTopN(), 1, "accepts 1 (minimum valid)");

    process.env["GROCERIES_SEARCH_TOP_N"] = "0";
    assert.equal(searchTopN(), 3, "falls back when zero");

    process.env["GROCERIES_SEARCH_TOP_N"] = "-2";
    assert.equal(searchTopN(), 3, "falls back when negative");

    process.env["GROCERIES_SEARCH_TOP_N"] = "abc";
    assert.equal(searchTopN(), 3, "falls back on non-numeric");

    process.env["GROCERIES_SEARCH_TOP_N"] = "";
    assert.equal(searchTopN(), 3, "falls back on empty string");
  } finally {
    if (saved === undefined) delete process.env["GROCERIES_SEARCH_TOP_N"];
    else process.env["GROCERIES_SEARCH_TOP_N"] = saved;
  }
});

// ─── listSearchStores ────────────────────────────────────────────────────────

test("listSearchStores returns all search-capable stores", () => {
  const stores = listSearchStores();
  assert.deepEqual(
    [...stores].sort(),
    ["aldi", "lidl", "publix", "shoprite", "walmart"],
  );
});

// ─── findDealsAcrossStores ───────────────────────────────────────────────────
// Tests redirect the cache to a tmpdir via GROCERIES_MCP_DATA_DIR and seed
// fixture snapshots so the dispatcher reads them instead of invoking scrapers.

const WEEK = "2026-04-22";

function dealItem(
  text: string,
  category: DealCategory,
  mealRelevant: boolean,
): { text: string; meal_relevant: boolean; category: DealCategory } {
  return { text, meal_relevant: mealRelevant, category };
}

type Item = ReturnType<typeof dealItem>;

function snapshot(
  store: string,
  bogos: Item[],
  sale: Item[],
  other: Item[],
): StoreDeals {
  return {
    store,
    source: `https://example.com/${store}`,
    fetched_at: "2026-04-25T12:00:00.000Z",
    week_starting: WEEK,
    deals: { bogos, sale_items: sale, other },
  };
}

async function withFixtureCache(
  fn: (seed: (store: DealStoreName, deals: StoreDeals) => Promise<void>) => Promise<void>,
): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "groceries-mcp-test-"));
  const saved = process.env["GROCERIES_MCP_DATA_DIR"];
  process.env["GROCERIES_MCP_DATA_DIR"] = tmpDir;
  try {
    await fn(async (store, deals) => {
      const dir = path.join(tmpDir, store);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${WEEK}.json`), JSON.stringify(deals));
    });
  } finally {
    if (saved === undefined) delete process.env["GROCERIES_MCP_DATA_DIR"];
    else process.env["GROCERIES_MCP_DATA_DIR"] = saved;
    await rm(tmpDir, { recursive: true, force: true });
  }
}

test("findDealsAcrossStores returns items grouped by store from cache", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [dealItem("Chicken thighs BOGO", "protein", true)],
        [dealItem("Strawberries $2.99", "produce", true)],
        [],
      ),
    );
    await seed(
      "aldi",
      snapshot("aldi", [], [dealItem("Spinach $1.99", "produce", true)], []),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix", "aldi"],
      weekStarting: WEEK,
    });

    assert.equal(result.week_starting, WEEK);
    assert.equal(result.by_store["publix"]?.match_count, 2);
    assert.equal(result.by_store["aldi"]?.match_count, 1);
    assert.equal(result.errors, undefined);
  });
});

test("findDealsAcrossStores filters out non-meal-relevant items by default", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Chicken thighs", "protein", true),
          dealItem("Toilet paper", "other", false),
        ],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
    });

    assert.equal(result.filters.meal_relevant_only, true);
    assert.equal(result.by_store["publix"]?.match_count, 1);
    assert.equal(result.by_store["publix"]?.items[0]?.text, "Chicken thighs");
  });
});

test("findDealsAcrossStores mealRelevantOnly=false keeps non-meal items", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Chicken thighs", "protein", true),
          dealItem("Toilet paper", "other", false),
        ],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
      mealRelevantOnly: false,
    });

    assert.equal(result.filters.meal_relevant_only, false);
    assert.equal(result.by_store["publix"]?.match_count, 2);
  });
});

test("findDealsAcrossStores filters by category", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Chicken thighs", "protein", true),
          dealItem("Strawberries", "produce", true),
          dealItem("Cheddar block", "dairy", true),
        ],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
      category: "produce",
    });

    assert.equal(result.filters.category, "produce");
    assert.equal(result.by_store["publix"]?.match_count, 1);
    assert.equal(result.by_store["publix"]?.items[0]?.text, "Strawberries");
  });
});

test("findDealsAcrossStores keyword match is case-insensitive substring", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Boneless Chicken Breast", "protein", true),
          dealItem("Strawberries", "produce", true),
          dealItem("Cheddar block", "dairy", true),
        ],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
      keywords: ["CHICKEN"],
    });

    assert.equal(result.by_store["publix"]?.match_count, 1);
    assert.equal(
      result.by_store["publix"]?.items[0]?.text,
      "Boneless Chicken Breast",
    );
  });
});

test("findDealsAcrossStores combines multiple keywords as OR", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Chicken Breast", "protein", true),
          dealItem("Strawberries", "produce", true),
          dealItem("Cheddar Cheese", "dairy", true),
          dealItem("Toilet paper", "other", false),
        ],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
      keywords: ["chicken", "cheese"],
    });

    assert.equal(result.by_store["publix"]?.match_count, 2);
  });
});

test("findDealsAcrossStores by_keyword breaks down per-keyword per-store", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [],
        [
          dealItem("Chicken Breast $3.99/lb", "protein", true),
          dealItem("Sargento Cheddar", "dairy", true),
        ],
        [],
      ),
    );
    await seed(
      "aldi",
      snapshot(
        "aldi",
        [],
        [dealItem("Kirkwood Chicken Thighs", "protein", true)],
        [],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix", "aldi"],
      weekStarting: WEEK,
      keywords: ["chicken", "cheddar"],
    });

    assert.ok(result.by_keyword, "by_keyword should be present");
    assert.equal(result.by_keyword["chicken"]?.["publix"]?.length, 1);
    assert.equal(result.by_keyword["chicken"]?.["aldi"]?.length, 1);
    assert.equal(result.by_keyword["cheddar"]?.["publix"]?.length, 1);
    assert.equal(result.by_keyword["cheddar"]?.["aldi"]?.length, 0);
  });
});

test("findDealsAcrossStores omits by_keyword when no keywords given", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot("publix", [], [dealItem("Chicken Breast", "protein", true)], []),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
    });

    assert.equal(result.by_keyword, undefined);
  });
});

test("findDealsAcrossStores flattens bogos, sale_items, and other into one list", async () => {
  await withFixtureCache(async (seed) => {
    await seed(
      "publix",
      snapshot(
        "publix",
        [dealItem("Chicken BOGO", "protein", true)],
        [dealItem("Spinach $1.99", "produce", true)],
        [dealItem("Sourdough Loaf", "bakery", true)],
      ),
    );

    const result = await findDealsAcrossStores({
      stores: ["publix"],
      weekStarting: WEEK,
    });

    assert.equal(result.by_store["publix"]?.match_count, 3);
    const texts = result.by_store["publix"]?.items.map((i) => i.text) ?? [];
    assert.deepEqual(texts.sort(), [
      "Chicken BOGO",
      "Sourdough Loaf",
      "Spinach $1.99",
    ]);
  });
});
