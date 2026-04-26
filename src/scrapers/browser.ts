/**
 * Single shared Chromium instance per process so consecutive scrapes don't pay
 * the cold-start cost. Closed via `closeBrowser()` on shutdown.
 */
import { Browser, BrowserContext, chromium } from "playwright";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    // Slightly slower but more reliable against sites that fingerprint headless.
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return browser;
}

/** Each scrape should use its own context so cookies don't leak between sites. */
export async function getContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
