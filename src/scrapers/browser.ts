/**
 * Browser singletons.
 *
 * Two browser instances are maintained:
 *   - `browser`        – plain Chromium for the weekly-deal scrapers (already work).
 *   - `stealthBrowser` – anti-detection browser for the item-price search
 *                        scrapers that hit PerimeterX / Akamai Bot Manager.
 *
 * The stealth browser has two interchangeable backends, selected via the
 * GROCERIES_STEALTH_BACKEND env var:
 *
 *   - "camoufox" (DEFAULT) – camoufox-js, a hardened Firefox fork with built-in
 *       fingerprint spoofing and humanized input. Defeats Walmart's PerimeterX.
 *   - "playwright-extra"   – Chromium + puppeteer-extra-plugin-stealth. Lighter,
 *       but PerimeterX detects it (Walmart fails; Aldi/ShopRite still work).
 *
 * All backend selection is contained in getStealthBrowser()/getStealthContext().
 * The SearchScraper interface and all callers are browser-agnostic.
 */
import { Browser, BrowserContext, chromium } from "playwright";

// ─── Standard context (weekly-deal scrapers) ─────────────────────────────────

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

// ─── Stealth browser (search scrapers) ───────────────────────────────────────

export type StealthBackend = "camoufox" | "playwright-extra";

/** Resolve the configured backend; camoufox is the default (defeats PerimeterX). */
export function stealthBackend(): StealthBackend {
  return process.env["GROCERIES_STEALTH_BACKEND"]?.toLowerCase() === "playwright-extra"
    ? "playwright-extra"
    : "camoufox";
}

let stealthBrowser: Browser | null = null;
let activeBackend: StealthBackend | null = null;

async function launchCamoufox(): Promise<Browser> {
  // camoufox-js returns a playwright-core Browser, structurally identical to
  // playwright's Browser. humanize:true randomizes mouse/timing — essential
  // for the PerimeterX press-and-hold challenge.
  const { Camoufox } = await import("camoufox-js");
  const b = await Camoufox({
    headless: true,
    humanize: true,
    locale: "en-US",
    os: ["windows", "macos"],
  });
  return b as unknown as Browser;
}

async function launchPlaywrightExtra(): Promise<Browser> {
  const { chromium: chromiumExtra } = await import("playwright-extra");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  chromiumExtra.use(StealthPlugin());
  const b = await chromiumExtra.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  return b as unknown as Browser;
}

async function getStealthBrowser(): Promise<Browser> {
  if (stealthBrowser && stealthBrowser.isConnected()) return stealthBrowser;
  activeBackend = stealthBackend();
  stealthBrowser =
    activeBackend === "camoufox"
      ? await launchCamoufox()
      : await launchPlaywrightExtra();
  return stealthBrowser;
}

/**
 * Returns a fresh BrowserContext backed by the stealth browser.
 * Each search scraper session should get its own context so cookies and
 * location state don't leak between concurrent requests.
 */
export async function getStealthContext(): Promise<BrowserContext> {
  const b = await getStealthBrowser();
  // camoufox bakes UA/fingerprint into the browser — DON'T override userAgent
  // or it breaks the spoof. playwright-extra needs the UA set explicitly.
  if (activeBackend === "camoufox") {
    return b.newContext({ viewport: { width: 1280, height: 800 } });
  }
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
}

export async function closeStealthBrowser(): Promise<void> {
  if (stealthBrowser) {
    await stealthBrowser.close().catch(() => {});
    stealthBrowser = null;
    activeBackend = null;
  }
}
