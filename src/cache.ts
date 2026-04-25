/**
 * Simple JSON-on-disk cache keyed on `(store, week_starting)`.
 *
 * Stored at `<data_dir>/<store>/<week_starting>.json` so each week's snapshot
 * lives in a stable file. No expiry — the cache is implicitly week-scoped, and
 * a manual `force_refresh` from the MCP client overwrites.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { StoreDeals, StoreDealsSchema, StoreName } from "./models.js";

/**
 * Resolve the data directory. Honors GROCERIES_MCP_DATA_DIR for deployment;
 * otherwise defaults under XDG_DATA_HOME (or ~/.local/share on macOS/Linux).
 */
export function dataDir(): string {
  if (process.env["GROCERIES_MCP_DATA_DIR"]) {
    return process.env["GROCERIES_MCP_DATA_DIR"];
  }
  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg) return path.join(xdg, "groceries-mcp");
  return path.join(os.homedir(), ".local", "share", "groceries-mcp");
}

function cachePath(store: StoreName, weekStarting: string): string {
  return path.join(dataDir(), store, `${weekStarting}.json`);
}

export async function readCache(
  store: StoreName,
  weekStarting: string,
): Promise<StoreDeals | null> {
  const file = cachePath(store, weekStarting);
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    return StoreDealsSchema.parse(parsed);
  } catch {
    // Corrupt cache file — treat as cache miss; caller will re-scrape.
    return null;
  }
}

export async function writeCache(deals: StoreDeals, store: StoreName): Promise<void> {
  const file = cachePath(store, deals.week_starting);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(deals, null, 2), "utf-8");
}

export interface CacheEntry {
  store: StoreName;
  week_starting: string;
  fetched_at: string;
  size_bytes: number;
}

export async function listCache(): Promise<CacheEntry[]> {
  const dir = dataDir();
  if (!existsSync(dir)) return [];
  const stores: StoreName[] = ["publix", "aldi", "lidl"];
  const entries: CacheEntry[] = [];
  for (const store of stores) {
    const storeDir = path.join(dir, store);
    if (!existsSync(storeDir)) continue;
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(storeDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const weekStarting = f.replace(/\.json$/, "");
      const file = path.join(storeDir, f);
      const st = await stat(file);
      // Read fetched_at without parsing the whole file.
      try {
        const raw = await readFile(file, "utf-8");
        const obj = JSON.parse(raw);
        entries.push({
          store,
          week_starting: weekStarting,
          fetched_at: obj.fetched_at ?? st.mtime.toISOString(),
          size_bytes: st.size,
        });
      } catch {
        // Skip unreadable entries.
      }
    }
  }
  entries.sort((a, b) => b.week_starting.localeCompare(a.week_starting));
  return entries;
}
