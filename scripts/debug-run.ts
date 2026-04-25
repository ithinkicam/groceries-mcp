/**
 * Run a single scraper without the MCP layer. Useful when iterating on
 * selectors against a live site.
 *
 *   npm run debug:run -- publix
 *   npm run debug:run -- aldi --no-cache
 */
import { adWeekStarting } from "../src/models.js";
import { getDeals, listStores } from "../src/dispatcher.js";
import { closeBrowser } from "../src/scrapers/browser.js";

const store = process.argv[2];
const noCache = process.argv.includes("--no-cache");

if (!store) {
  console.error(`Usage: debug-run <store> [--no-cache]\nStores: ${listStores().join(", ")}`);
  process.exit(1);
}

const stores = listStores();
if (!stores.includes(store as (typeof stores)[number])) {
  console.error(`Unknown store "${store}". Try one of: ${stores.join(", ")}`);
  process.exit(1);
}

const week = adWeekStarting();
console.log(`Scraping ${store} for week of ${week}${noCache ? " (forcing refresh)" : ""}...`);
const t0 = Date.now();

try {
  const deals = await getDeals({
    store: store as (typeof stores)[number],
    forceRefresh: noCache,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const total =
    deals.deals.bogos.length +
    deals.deals.sale_items.length +
    deals.deals.other.length;
  const mealRelevant =
    deals.deals.bogos.filter((d) => d.meal_relevant).length +
    deals.deals.sale_items.filter((d) => d.meal_relevant).length +
    deals.deals.other.filter((d) => d.meal_relevant).length;
  console.log(`Done in ${elapsed}s — ${total} items, ${mealRelevant} meal-relevant.`);
  console.log(`Source: ${deals.source}`);
  console.log(`First 5 meal-relevant items:`);
  const all = [...deals.deals.bogos, ...deals.deals.sale_items, ...deals.deals.other];
  all
    .filter((d) => d.meal_relevant)
    .slice(0, 5)
    .forEach((d) => console.log(`  - ${d.text}`));
} catch (err) {
  console.error("Scrape failed:", err);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
