/**
 * Aldi probe — dump the full shape of one Items GraphQL response so we can
 * design the parser. Load page, click Shop Now, capture the first Items
 * response body, write to /tmp/aldi-items-sample.json.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = "https://www.aldi.us/weekly-specials/weekly-ads";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
});
const page = await ctx.newPage();

let captured: string | null = null;
page.on("response", async (resp) => {
  if (captured) return;
  const url = resp.url();
  if (!/\/graphql\?operationName=Items\b/.test(url)) return;
  try {
    const body = await resp.text();
    if (body.length > 1000) {
      captured = body;
    }
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForTimeout(8_000);
const cta = page.locator('a:has-text("Shop Now")').first();
if ((await cta.count()) > 0) {
  await cta.click({ timeout: 5_000 });
  // Wait until we capture an Items response.
  for (let i = 0; i < 20 && !captured; i++) {
    await page.waitForTimeout(1_000);
  }
}

if (captured) {
  // Pretty-print the first item only — that's enough to design parsing.
  const data = JSON.parse(captured);
  const firstItem = data?.data?.items?.[0];
  console.log("First item keys:", firstItem ? Object.keys(firstItem) : "(none)");
  writeFileSync("/tmp/aldi-items-sample.json", JSON.stringify(firstItem, null, 2));
  console.log("Wrote /tmp/aldi-items-sample.json");
  console.log(`Total items in this batch: ${data?.data?.items?.length ?? 0}`);
} else {
  console.log("No Items response captured.");
}

await browser.close();
