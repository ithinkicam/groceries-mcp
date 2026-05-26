/**
 * Walmart item-price search scraper.
 *
 * Ported from the reference Python scraper. Strategy:
 *   1. `setLocation` — load walmart.com (let any challenge settle), then the
 *      store-finder, capturing the nearest store's node ID from the
 *      `storeFinderNearbyNodesQuery` GraphQL response and injecting it as the
 *      `assortmentStoreId` cookie so search pages show local prices.
 *   2. `search` — navigate to walmart.com/search?q=<item>, let the auto-solver
 *      clear any PerimeterX challenge, then extract the first product tile.
 *
 * Requires the camoufox stealth backend to get past PerimeterX. With the
 * playwright-extra backend the challenge is not solvable and search returns
 * a blocked error.
 */
import { type Page, type Response } from "playwright";
import { PriceSearchResult } from "../models.js";
import { SearchScraper } from "./base.js";
import { attachCaptchaSolver, solvePxChallenge } from "./walmart-captcha.js";

const BASE_URL = "https://www.walmart.com";

// e.g. "current price Now $4.98" or "current price $4.98"
const PRICE_RE = /current price (?:Now\s+)?\$?([\d]+\.\d{2})/i;

export class WalmartSearchScraper implements SearchScraper {
  readonly name = "walmart";
  readonly displayName = "Walmart";

  async setLocation(page: Page, zipCode: string): Promise<void> {
    attachCaptchaSolver(page);

    let storeId: string | null = null;
    const onResponse = async (resp: Response): Promise<void> => {
      if (!resp.url().includes("storeFinderNearbyNodesQuery")) return;
      try {
        const json = (await resp.json()) as {
          data?: { nearByNodes?: { nodes?: Array<{ id?: string }> } };
        };
        const nodes = json?.data?.nearByNodes?.nodes ?? [];
        if (nodes[0]?.id && !storeId) storeId = String(nodes[0].id);
      } catch {
        /* ignore parse failures on unrelated responses */
      }
    };
    page.on("response", onResponse);

    try {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);

      await page.goto(`${BASE_URL}/store-finder?location=${encodeURIComponent(zipCode)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });

      // GraphQL fires after the page + any challenge settle; poll up to 20s.
      for (let i = 0; i < 20; i++) {
        if (storeId) break;
        await page.waitForTimeout(1_000);
      }
    } finally {
      page.off("response", onResponse);
    }

    if (storeId) {
      await page.context().addCookies([
        {
          name: "assortmentStoreId",
          value: storeId,
          domain: "www.walmart.com",
          path: "/",
          secure: true,
          sameSite: "Lax",
        },
      ]);
      console.error(`[walmart] store set to ID ${storeId}`);
    } else {
      console.error("[walmart] could not determine store ID for ZIP, using IP-detected store");
    }
  }

  async search(page: Page, item: string, limit: number): Promise<PriceSearchResult[]> {
    const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(item)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // Auto-solver fires via the load event; give it time, then make sure.
    await page.waitForTimeout(2_000);
    await solvePxChallenge(page);

    try {
      await page.waitForSelector("[data-item-id]", { timeout: 25_000, state: "attached" });
    } catch {
      // Distinguish a hard block from a genuine no-result.
      const blocked =
        (await page.title().catch(() => "")).includes("Robot or human") ||
        page.url().includes("blocked");
      if (blocked) {
        return [
          {
            store: this.name,
            query: item,
            matched_name: null,
            price: null,
            error:
              "Walmart blocked this request (PerimeterX challenge unsolved). " +
              "Use the camoufox stealth backend (GROCERIES_STEALTH_BACKEND=camoufox).",
            url: searchUrl,
          },
        ];
      }
      return [];
    }

    const raw = await page.evaluate((max: number) => {
      // Build a parsed record per tile. A tile is sponsored if its product
      // link is an ad redirect (the most reliable signal — present even when
      // no "Sponsored" label renders) or it has an element whose text is
      // exactly "Sponsored". Avoid named helper functions here: esbuild's
      // keep-names transform wraps them with a __name() call that is undefined
      // in the browser context.
      const tiles = Array.from(document.querySelectorAll("[data-item-id]"));
      const parsed: Array<{
        name: string | null;
        priceText: string;
        link: string | null;
        sponsored: boolean;
      }> = [];

      for (const tile of tiles) {
        const name =
          tile.querySelector('[data-automation-id="product-title"]')?.textContent?.trim() ??
          null;
        const priceText =
          tile.querySelector('[data-automation-id="product-price"]')?.textContent?.trim() ?? "";
        const linkEl =
          tile.querySelector('a[href*="/ip/"]') ?? tile.querySelector("a[link-identifier]");
        const link = linkEl instanceof HTMLAnchorElement ? linkEl.href : null;

        let sponsored = link !== null && /\/sp\/track|adsRedirect|adUid/.test(link);
        if (!sponsored) {
          for (const el of Array.from(tile.querySelectorAll("*"))) {
            const directText = Array.from(el.childNodes)
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent?.trim() ?? "")
              .join("");
            if (/^sponsored$/i.test(directText)) {
              sponsored = true;
              break;
            }
          }
        }
        if (name) parsed.push({ name, priceText, link, sponsored });
      }

      // Prefer organic tiles; only fall back to sponsored ones if there aren't
      // enough organic results to fill the limit.
      const organic = parsed.filter((p) => !p.sponsored);
      const chosen = organic.length >= max ? organic : [...organic, ...parsed.filter((p) => p.sponsored)];
      return chosen.slice(0, max);
    }, limit);

    return raw.map((r) => {
      const m = PRICE_RE.exec(r.priceText);
      const price = m?.[1] !== undefined ? parseFloat(m[1]) : null;
      return {
        store: this.name,
        query: item,
        matched_name: r.name,
        price: isNaN(price ?? NaN) ? null : price,
        url: r.link ?? searchUrl,
      };
    });
  }
}
