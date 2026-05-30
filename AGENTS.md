# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Gemini CLI, etc.) when working with code in this repository.

## Commands

```bash
npm run build          # compile TypeScript → dist/
npm run dev            # watch mode
npm test               # run all tests
npm run typecheck      # type-check without emitting
```

Run a single test file:
```bash
node --test --import tsx tests/models.test.ts
```

Smoke-test a scraper against the live site:
```bash
PUBLIX_STORE_ID=1591 npm run debug:run -- publix
npm run debug:run -- aldi --no-cache
npm run debug:run -- lidl
```

Find a Publix store ID by zip code:
```bash
npm run find-publix-store -- 23060
```

## Architecture

This is an ESM TypeScript MCP server (Node 22+). Entry point is `src/index.ts`.

### Layer overview

| Layer | File(s) | Responsibility |
|---|---|---|
| Tools / transport | `src/index.ts` | MCP tool registration; stdio vs. HTTP transport selection |
| Dispatch + cache | `src/dispatcher.ts` | Routes tool calls through cache → scraper; implements `findDealsAcrossStores` |
| Cache | `src/cache.ts` | JSON-on-disk, keyed by `(store, week_starting)`. No TTL — week-scoped by design |
| Scrapers | `src/scrapers/*.ts` | One file per store; all implement `Scraper` in `src/scrapers/base.ts` |
| Data shapes | `src/models.ts` | Zod schemas; canonical contract for all scrapers |

### Data flow

```
MCP tool call
  → dispatcher.getDeals()
      → cache hit? return cached StoreDeals
      → miss: scraper.scrape(weekStarting) → StoreDeals
          → write cache
          → return
```

`get_all_deals` and `find_deals` run scrapers sequentially (not in parallel) because Playwright contexts share a single browser instance and can step on each other.

### Scraper details

- **Publix** (`src/scrapers/publix.ts`): Direct REST call to `services.publix.com/api/v4/savings`. Requires `PUBLIX_STORE_ID`. Fast (~2s, ~200+ items).
- **Aldi** (`src/scrapers/aldi.ts`): Playwright drives the "Shop Now" CTA into the catalog and intercepts `Items` GraphQL responses as products lazy-load. Slow (~30s, ~150–200 items).
- **Lidl** (`src/scrapers/lidl.ts`): Playwright navigates `lidl.com/specials` and extracts product-card text. Fast (~5s, ~70 items).

All Playwright scrapers share a single `Browser` instance managed by `src/scrapers/browser.ts`. `SIGINT`/`SIGTERM` handlers in `src/index.ts` call `closeBrowser()` on shutdown.

### Adding a new store

1. Create `src/scrapers/<store>.ts` implementing `Scraper` from `src/scrapers/base.ts`.
2. Add it to the `SCRAPERS` map in `src/dispatcher.ts`.
3. Register a tool in `src/index.ts` via `registerStoreTool()`.

### Output shape

Every scraper must return `StoreDeals` (defined in `src/models.ts`). Deals are sorted into three buckets: `bogos`, `sale_items`, `other`. Each `DealItem` carries `text`, `meal_relevant`, optional `category`, `price`, `is_bogo`, and `half_price` (Virginia BOGO state). Full contract: `docs/DEAL-SHAPE.md`.

### HTTP transport

The HTTP mode uses token-in-path auth (`<prefix>/<token>`) rather than `Authorization` headers, because claude.ai's connector UI has no header field. One `McpServer` per HTTP session, keyed by `mcp-session-id`. Run behind Tailscale Funnel for remote access.

### Cache location

Default: `~/.local/share/groceries-mcp/<store>/<week_starting>.json`. Override with `GROCERIES_MCP_DATA_DIR`. Safe to delete to force a re-scrape.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `PUBLIX_STORE_ID` | For Publix | 4-digit store number |
| `GROCERIES_MCP_TOKEN` | For HTTP | Secret path segment |
| `GROCERIES_MCP_PATH_PREFIX` | For HTTP | Funnel route prefix (e.g. `/groceries`) |
| `GROCERIES_MCP_PORT` | No | HTTP port (default `3939`) |
| `GROCERIES_MCP_HOST` | No | Bind address (default `127.0.0.1`) |
| `GROCERIES_MCP_DATA_DIR` | No | Cache directory override |
