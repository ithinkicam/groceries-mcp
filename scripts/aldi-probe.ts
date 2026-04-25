/**
 * Reference probe for iterating on the Aldi scraper.
 *
 * As of April 2026, aldi.us/weekly-specials/weekly-ads no longer renders the
 * ad inline — it shows a "Start Shopping" CTA. This script logs the page's
 * frame topology and any iframes, so you can quickly see whether Aldi has
 * reverted to inline ads or moved to a different pattern.
 *
 * Run with:  npm run build && node --import tsx scripts/aldi-probe.ts
 *
 * Suggested next steps when picking this back up:
 *   1. Open DevTools network panel against aldi.us and click "Start Shopping".
 *      Look for an XHR returning a JSON product list (likely info.aldi.us/api/...).
 *      Fetching that JSON directly is more durable than driving the UI.
 *   2. If no JSON endpoint, drive the click flow with Playwright Inspector
 *      (`PWDEBUG=1 node ...`) and capture the post-click DOM structure.
 */
import { chromium } from "playwright";

const URL = "https://www.aldi.us/weekly-specials/weekly-ads";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForTimeout(8_000);

console.log(`Title: ${await page.title()}`);
console.log(`Frames (${page.frames().length}):`);
for (const f of page.frames()) console.log(`  ${f.url() || "(blank)"}`);

const iframes = await page.evaluate(() =>
  Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "(no src)"),
);
console.log(`\nNested iframes (${iframes.length}):`);
for (const s of iframes) console.log(`  ${s}`);

const bodyTextHead = await page.evaluate(() => document.body.innerText.slice(0, 1500));
console.log(`\nBody text (first 1500 chars):\n${bodyTextHead}`);

await browser.close();
