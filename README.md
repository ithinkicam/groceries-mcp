# groceries-mcp

A Model Context Protocol server that returns weekly grocery deals from
**Publix**, **Aldi**, and **Lidl** as normalized JSON — so an LLM can answer
"what's on sale this week?" without driving a browser for 30 turns.

Scraping is TypeScript + Playwright. Results are cached on disk per
`(store, week_starting_wednesday)` so re-asking the same question costs
nothing.

## What it exposes

| Tool | What it does |
|---|---|
| `list_stores()` | Lists supported stores. |
| `get_publix_deals(week_of?, force_refresh?)` | Publix in isolation. ~2s. |
| `get_aldi_deals(week_of?, force_refresh?)` | Aldi in isolation. ~30s. |
| `get_lidl_deals(week_of?, force_refresh?)` | Lidl in isolation. ~5s. |
| `get_all_deals(week_of?, force_refresh?)` | All three at once, partial success. |
| `cache_status()` | What's on disk: which stores, which weeks, file sizes. |

The per-store tools share an input schema and return the same `StoreDeals`
shape. They exist as separate tools so claude.ai can call them by name without
an outer `store` parameter — useful when the user wants "just check Publix
this week."

Sample output (per store):

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

## Install

Requires Node 22+.

```bash
git clone https://github.com/ithinkicam/groceries-mcp
cd groceries-mcp
npm install            # also installs the Chromium binary via Playwright
npm run build
```

Quick smoke test, no MCP layer involved:

```bash
npm run debug:run -- publix
npm run debug:run -- aldi --no-cache
```

## Local use (Claude Code, stdio)

Register the built binary as a stdio MCP in Claude Code:

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

Restart Claude Code. The four `get_*_deals` tools, `list_stores`, and
`cache_status` should appear in the tool list.

## Remote use (claude.ai, HTTP over Tailscale Funnel)

claude.ai's connector UI takes a URL and nothing else — no header field, no
auth tab. The convention this server follows is **secret in the URL path**:
the server only handles requests at `<prefix>/<token>`, where `<token>` is a
random string you generate. Anyone who hits the bare prefix without the token
gets a 404. (Same pattern several other MCP servers use behind Funnel.)

### 1. Generate a token

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# e.g. J6DdWk_37KZ8ydKcHPPT5AUDy7TYD-5I
```

### 2. Run the HTTP server

```bash
GROCERIES_MCP_PATH_PREFIX=/groceries \
GROCERIES_MCP_TOKEN=<your-token> \
GROCERIES_MCP_PORT=8768 \
node dist/index.js --transport http
```

The server logs the full path it's serving at on startup.

### 3. Add the Funnel route

```bash
tailscale funnel --bg --set-path=/groceries http://127.0.0.1:8768/groceries
```

The connector URL for claude.ai is then:

```
https://<your-tailnet-host>.ts.net/groceries/<your-token>
```

### 4. Autostart on macOS (optional)

Drop this at `~/Library/LaunchAgents/com.groceries-mcp.server.plist`,
substituting your token, install path, and home directory:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.groceries-mcp.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/you/groceries-mcp/dist/index.js</string>
        <string>--transport</string>
        <string>http</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/you/groceries-mcp</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>GROCERIES_MCP_TOKEN</key>
        <string>REPLACE_WITH_YOUR_TOKEN</string>
        <key>GROCERIES_MCP_HOST</key>
        <string>127.0.0.1</string>
        <key>GROCERIES_MCP_PORT</key>
        <string>8768</string>
        <key>GROCERIES_MCP_PATH_PREFIX</key>
        <string>/groceries</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/you/Library/Logs/groceries-mcp-server.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/you/Library/Logs/groceries-mcp-server.err.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.groceries-mcp.server.plist
launchctl list | grep groceries-mcp   # should show a PID
```

### 5. Smoke test

```bash
curl -i -X POST https://<your-tailnet-host>.ts.net/groceries/<your-token> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

A `200` with a `mcp-session-id` header and the server's `name`/`version` in
the body means you're done. The bare prefix without the token must return
`404`.

## Environment variables

| Var | Purpose |
|---|---|
| `GROCERIES_MCP_HOST` | Bind address. Default `127.0.0.1`. |
| `GROCERIES_MCP_PORT` | HTTP port. Default `3939`. |
| `GROCERIES_MCP_PATH_PREFIX` | Funnel route prefix (e.g. `/groceries`). |
| `GROCERIES_MCP_TOKEN` | Secret path segment. Required for remote exposure. |
| `GROCERIES_MCP_DATA_DIR` | Cache directory override. |

## Cache

- Default location: `$XDG_DATA_HOME/groceries-mcp` (or `~/.local/share/groceries-mcp`).
- Override with `GROCERIES_MCP_DATA_DIR=/path/to/dir`.
- Per-store directories with `<week_starting>.json` files. Safe to delete to
  force a re-scrape.

## Status by store

Verified live on **2026-04-26**:

| Store | Method | Status |
|---|---|---|
| Publix | iHeartPublix HTML scrape | Working — 250 items, ~2s |
| Aldi | Playwright + GraphQL `Items` observation | Working — 178 items, ~30s. Drives the "Shop Now" CTA into the catalog and observes the `Items` GraphQL responses as products lazy-load. |
| Lidl | Playwright + product cards | Working — ~70 items, ~5s |

**Walmart** is intentionally not supported. `walmart.com/shop/savings/food`
is gated by Akamai bot detection that blocks headless browsers. Working around
it requires either cookie-jar reuse from a real Chrome (host-coupled), stealth-
plugin arms-racing, or paid proxy services — all real engineering with ongoing
maintenance, for what's a secondary store in this household.

When a scraper breaks, the dispatcher returns a clear error for that store and
keeps the others working — `get_all_deals` is partial-success by design.

## Updating Playwright Chromium

`npm install` runs `playwright install chromium` automatically. To upgrade the
browser binary:

```bash
npm install playwright@latest
npx playwright install chromium
```

If the host can't download Chromium at install time (firewall etc.), set
`PLAYWRIGHT_DOWNLOAD_HOST` or pre-bundle the browser.

## License

MIT — see [LICENSE](LICENSE).
