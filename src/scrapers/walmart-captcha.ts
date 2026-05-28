/**
 * PerimeterX press-and-hold CAPTCHA solver for Walmart.
 *
 * Ported from the reference Python scraper (web-scraping-scripts/grocery).
 * The challenge presents a "Press & Hold" button; PerimeterX scores the hold
 * gesture. Two details are load-bearing:
 *
 *   1. Approach the button from above (move to cy-20, then to cy) so the
 *      pointer trajectory looks human rather than teleported.
 *   2. Hold *completely still* for ~8s. Any intermediate mouse events during
 *      the hold flag the gesture as automated, so do NOT add jitter.
 *
 * This only works reliably with the camoufox backend (humanized Firefox).
 * playwright-extra + stealth is still detected by PerimeterX.
 *
 * Usage:
 *   attachCaptchaSolver(page);  // once after creating the page
 * The solver auto-fires on every page load; you can also call
 * solvePxChallenge(page) explicitly after a navigation.
 */
import { type Page } from "playwright";

const HOLD_MS = 8_000;
const MAX_ATTEMPTS = 3;

/** True if the page is currently showing the PerimeterX block/challenge. */
async function isChallenged(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  return title.includes("Robot or human") || page.url().includes("blocked");
}

/**
 * Attempt to solve the PerimeterX press-and-hold challenge.
 * Returns true if the page is clear of the challenge (either it was solved or
 * was never present), false if all attempts failed.
 */
export async function solvePxChallenge(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!(await isChallenged(page))) return true;

    try {
      await page.waitForSelector("#px-captcha", { timeout: 10_000 });
    } catch {
      console.error(`[walmart] challenge attempt ${attempt + 1}: #px-captcha not found`);
      await page.waitForTimeout(2_000);
      continue;
    }

    const rect = await page.evaluate(() => {
      const el = document.querySelector("#px-captcha");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (!rect) {
      await page.waitForTimeout(2_000);
      continue;
    }

    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    // Approach from above, then settle on the button.
    await page.mouse.move(cx, cy - 20);
    await page.waitForTimeout(200);
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(300);

    // Press and hold completely still — no intermediate events.
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();

    // Poll up to 10s for navigation away from the challenge.
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1_000);
      if (!(await isChallenged(page))) {
        console.error(`[walmart] challenge solved on attempt ${attempt + 1}`);
        return true;
      }
    }
    console.error(`[walmart] challenge attempt ${attempt + 1} failed, retrying`);
    await page.waitForTimeout(1_000);
  }
  return false;
}

/**
 * Wire a load-event handler so the challenge is auto-solved on ANY page load,
 * not just where we explicitly call solvePxChallenge. A reentrancy guard
 * prevents overlapping solve attempts.
 */
export function attachCaptchaSolver(page: Page): void {
  let solving = false;
  page.on("load", () => {
    if (solving) return;
    solving = true;
    void (async () => {
      try {
        await page.waitForTimeout(500); // let the title settle
        if (await isChallenged(page)) {
          console.error("[walmart] auto-solver: challenge detected on load");
          await solvePxChallenge(page);
        }
      } catch {
        /* best-effort */
      } finally {
        solving = false;
      }
    })();
  });
}
