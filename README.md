# groceries-mcp

A Model Context Protocol server that returns weekly grocery deals from
**Publix**, **Aldi**, **Lidl**, and **Walmart** as normalized JSON. Built to be
called by a meal-planning workflow in Claude — no more "let me drive a browser
for 30 turns to find this week's chicken sale."

The scraping logic lives in real code (TypeScript + Playwright), the deal
shape is the same one a [legacy Python pipeline][legacy] produced, and results
are cached on disk per `(store, week_starting_wednesday)` so re-asking the
same question costs nothing.

[legacy]: https://github.com/ithinkicam/dotfiles  <!-- the meal-planner skill -->

## What it exposes

| Tool | What it does |
|---|---|
| `list_stores()` | Lists supported stores. |
| `get_deals(store, week_of?, force_refresh?)` | Returns one store's deals. Cached. |
| `get_all_deals(week_of?, force_refresh?)` | Returns every store, partial success. Cached. |
| `cache_status()` | Lists what's on disk: which stores, which weeks, file sizes. |

Every tool returns JSON in this shape (per store):

```json
{
  "store": "Publix",
  "source": "https://www.iheartpublix.com/2026/04/...",
  "fetched_at": "2026-04-25T11:37:00.000Z",
  "week_starting": "2026-04-22",
  "deals": {
    "bogos": [
      {
        "text": "Chicken thighs, BOGO $5.99",
        "meal_relevant": true,
        "category": "protein",
        "price": "5.99",
        "is_bogo": true,
        "half_price": "3.00"
      }
    ],
    "sale_items": [...],
    "other": [...]
  }
}
```

The full contract lives in [`docs/DEAL-SHAPE.md`](docs/DEAL-SHAPE.md).

## Local quick start

```bash
git clone https://github.com/ithinkicam/groceries-mcp
cd groceries-mcp
npm install            # also installs the Chromium binary via Playwright
npm run build

# Hit a single scraper without the MCP layer:
npm run debug:run -- publix
npm run debug:run -- aldi --no-cache
```

Once you have it working locally, register it with Claude Code:

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "groceries": {
      "command": "node",
      "args": ["/path/to/groceries-mcp/dist/index.js"]
    }
  }
}
```

## Remote deployment (Tailscale Funnel)

The HTTP transport is what claude.ai talks to over Tailscale Funnel:

```bash
PORT=3939 node dist/index.js --transport http
```

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the Funnel + launchd recipe (TBD —
this repo provides the server; the deployment glue is added on the host that
runs it).

## Cache layout

- Default location: `$XDG_DATA_HOME/groceries-mcp` (or `~/.local/share/groceries-mcp`).
- Override with `GROCERIES_MCP_DATA_DIR=/path/to/dir`.
- Per-store directories with `<week_starting>.json` files. Safe to delete to force a re-scrape.

## Status by store

Verified live on **2026-04-25**:

| Store | Method | Status |
|---|---|---|
| Publix | iHeartPublix HTML scrape | ✅ Working — 250 items, 1.8s |
| Aldi | Playwright + GraphQL Items observation | ✅ Working — 178 items, 29s. Drives the "Shop Now" CTA into the catalog and observes the `Items` GraphQL responses as products lazy-load. |
| Lidl | Playwright + product cards | ✅ Working — ~70 items, 5s |
| Walmart | Playwright | ⚠️ Akamai bot detection blocks headless. Returns a "blocked" marker rather than throwing, so `get_all_deals` keeps working. |

When a scraper breaks, the dispatcher returns a clear error for that store and
keeps the others working — `get_all_deals` is partial-success by design.

## License

MIT — see [LICENSE](LICENSE).
