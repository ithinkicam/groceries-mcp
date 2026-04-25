# Deploy

## What this repo provides

A working MCP server you can run locally (stdio) or as an HTTP service. The
server is otherwise host-agnostic: any way you can reach `port 3939` over
HTTPS will work.

## What this repo deliberately doesn't provide

- Tailscale Funnel exposure
- launchd / systemd autostart
- Reverse proxy / TLS termination
- Scheduled refresh (cron-style auto re-scrape on ad-drop day)

These are environment-specific and live in your host's deployment recipe, not
in the server itself. The intended target is **Cami's secondary Mac Mini**,
which already runs a small fleet of MCPs over Tailscale Funnel.

## Open task: Tailscale Funnel + Mac Mini autostart

When wiring this up on the Mini, the steps are roughly:

1. Clone the repo and `npm install && npm run build`.
2. Choose a port that doesn't collide with the other 4 MCPs.
3. Pick where the cache lives. Default is `~/.local/share/groceries-mcp`;
   override with `GROCERIES_MCP_DATA_DIR=/var/lib/groceries-mcp`.
4. Wire up a launchd `LaunchAgent` (or `LaunchDaemon`) that runs:
   `node /opt/groceries-mcp/dist/index.js --transport http --port <port>`
5. Expose the port through Tailscale Funnel — same pattern as the existing 4 MCPs.
6. Configure claude.ai's connector UI to point at the Funnel URL.

The intent is to **mirror what's already working for the existing MCPs** rather
than invent a new pattern — Claude Code on the Mini, with access to those repos,
should be able to apply the same pattern here.

## Health check

The server logs "groceries-mcp listening on http://0.0.0.0:<port>/" on startup
when in HTTP mode. There isn't currently a `/healthz` endpoint — if you need
one for a load balancer, it's a small addition (open an issue or PR).

## Environment variables

| Var | Purpose |
|---|---|
| `GROCERIES_MCP_DATA_DIR` | Override cache directory. |
| `PORT` | HTTP port (only when `--transport http`). |
| `XDG_DATA_HOME` | Standard XDG fallback for cache root. |

## Updating Playwright Chromium

`npm install` runs `playwright install chromium` automatically. To upgrade
the browser binary on a deployed host:

```bash
npm install playwright@latest
npx playwright install chromium
```

If the host can't download the Chromium binary at install time (corporate
firewall etc.), set `PLAYWRIGHT_DOWNLOAD_HOST` or pre-bundle the browser.
