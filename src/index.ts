/**
 * groceries-mcp — entry point.
 *
 * Two transports:
 *   - stdio  (default; for local Claude Code testing)
 *   - http   (Streamable HTTP; for remote exposure via Tailscale Funnel)
 *
 * Usage:
 *   node dist/index.js                      # stdio
 *   node dist/index.js --transport http     # HTTP on PORT (default 3939)
 *
 * HTTP env vars (used when running behind Tailscale Funnel):
 *   GROCERIES_MCP_HOST          bind address (default 127.0.0.1)
 *   GROCERIES_MCP_PORT          port (default 3939; --port flag wins)
 *   GROCERIES_MCP_PATH_PREFIX   funnel route prefix (e.g. /groceries)
 *   GROCERIES_MCP_TOKEN         secret path segment appended to the prefix
 *                               so the public URL is <prefix>/<token>. claude.ai
 *                               doesn't take bearer headers, so the secret has
 *                               to live in the URL.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { randomUUID } from "node:crypto";

import {
  AllDealsResult,
  StoreDeals,
  StoreError,
  adWeekStarting,
} from "./models.js";
import { getDeals, listStores } from "./dispatcher.js";
import { listCache } from "./cache.js";
import { closeBrowser } from "./scrapers/browser.js";

/**
 * Common input schema for the per-store tools — same args, just dispatched
 * against a different scraper. Defined once so descriptions stay consistent.
 */
const PER_STORE_INPUT_SCHEMA = {
  week_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "ISO date (YYYY-MM-DD); rounded back to the Wednesday of that ad week. Defaults to current week.",
    ),
  force_refresh: z
    .boolean()
    .optional()
    .describe("Bypass the cache and re-scrape even if a snapshot exists for this week."),
};

function registerStoreTool(
  server: McpServer,
  store: "publix" | "aldi" | "lidl",
  displayName: string,
  opts: { notes: string },
): void {
  server.registerTool(
    `get_${store}_deals`,
    {
      description:
        `Get this week's deals from ${displayName} as normalized JSON. ` +
        `Reads from cache when available; pass force_refresh=true to re-scrape. ` +
        opts.notes,
      inputSchema: PER_STORE_INPUT_SCHEMA,
    },
    async ({ week_of, force_refresh }) => {
      const week = week_of ? adWeekStarting(new Date(week_of)) : undefined;
      const deals = await getDeals({
        store,
        ...(week !== undefined ? { weekStarting: week } : {}),
        ...(force_refresh !== undefined ? { forceRefresh: force_refresh } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(deals, null, 2) }],
      };
    },
  );
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "groceries-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "list_stores",
    {
      description: "List the store names this server can return deals for.",
      inputSchema: {},
    },
    async () => {
      const stores = listStores();
      return {
        content: [{ type: "text", text: JSON.stringify({ stores }, null, 2) }],
      };
    },
  );

  // Per-store tools — discoverable by name in claude.ai's tool UI, callable
  // in isolation without an outer "store" arg. Each shares the same cache and
  // input schema; the only difference is which scraper they dispatch to.
  registerStoreTool(server, "publix", "Publix", {
    notes:
      "Source: iHeartPublix.com. Returns BOGO deals with `half_price` set " +
      "(Virginia is a half-price BOGO state). Fast (~2s). 200+ items typical.",
  });
  registerStoreTool(server, "aldi", "Aldi", {
    notes:
      "Drives the 'Shop Now' CTA into Aldi's catalog and observes the Items " +
      "GraphQL responses as products lazy-load. Slower (~30s) due to " +
      "browser-driven scrolling. ~150-200 items typical.",
  });
  registerStoreTool(server, "lidl", "Lidl", {
    notes:
      "Source: lidl.com/specials. Playwright + product-card text extraction. " +
      "Fast (~5s). ~70 items typical.",
  });

  server.registerTool(
    "get_all_deals",
    {
      description:
        "Get this week's deals for every supported store. Partial success: each store either returns a normal deals payload or an error entry; the request as a whole always succeeds.",
      inputSchema: {
        week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        force_refresh: z.boolean().optional(),
      },
    },
    async ({ week_of, force_refresh }) => {
      const week = week_of ? adWeekStarting(new Date(week_of)) : adWeekStarting();
      const stores = listStores();
      const results: Record<string, StoreDeals | StoreError> = {};
      // Run scrapers sequentially. Concurrent Playwright contexts share a
      // single browser instance and can step on each other for cookies.
      for (const store of stores) {
        try {
          results[store] = await getDeals({
            store,
            weekStarting: week,
            ...(force_refresh !== undefined ? { forceRefresh: force_refresh } : {}),
          });
        } catch (err) {
          results[store] = {
            store,
            error: err instanceof Error ? err.message : String(err),
            fetched_at: new Date().toISOString(),
          };
        }
      }
      const payload: AllDealsResult = { week_starting: week, results };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.registerTool(
    "cache_status",
    {
      description:
        "List cached snapshots on disk: which stores, which weeks, when fetched, file sizes.",
      inputSchema: {},
    },
    async () => {
      const entries = await listCache();
      return {
        content: [{ type: "text", text: JSON.stringify({ entries }, null, 2) }],
      };
    },
  );

  return server;
}

function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio runs until the parent closes the pipe.
}

interface HttpOptions {
  host: string;
  port: number;
  pathPrefix: string;
  token: string;
}

async function runHttp(opts: HttpOptions): Promise<void> {
  // One McpServer per session, keyed by session id from the protocol.
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  const { host, port, pathPrefix, token } = opts;
  // Public path is <prefix>/<token>. Token-as-path-segment is the convention
  // (matches keep-mcp) because claude.ai's connector UI has no field for an
  // Authorization header — the secret has to be embedded in the URL itself.
  const requiredPath = token
    ? `${pathPrefix}/${token}`
    : pathPrefix;

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (requiredPath) {
        const url = req.url ?? "/";
        const pathOnly = url.split("?")[0] ?? "/";
        if (
          pathOnly !== requiredPath &&
          !pathOnly.startsWith(requiredPath + "/")
        ) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
      }

      const sid = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sid) ? sid[0] : sid;
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (!entry) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport });
          },
        });
        const server = createServer();
        await server.connect(transport);
        entry = { server, transport };
      }

      // Buffer the body so we can hand it to the SDK as a parsed JSON object.
      let body: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
        }
      }

      await entry.transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("HTTP request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  });

  httpServer.listen(port, host, () => {
    const display = requiredPath || "/";
    console.error(
      `groceries-mcp listening on http://${host}:${port}${display} ` +
        `(token-in-path: ${token ? "yes" : "no"})`,
    );
  });
}

async function shutdown(): Promise<void> {
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = getArg("--transport", "stdio");
if (transport === "http") {
  const port = parseInt(
    getArg(
      "--port",
      process.env["GROCERIES_MCP_PORT"] ?? process.env["PORT"] ?? "3939",
    ),
    10,
  );
  const host = process.env["GROCERIES_MCP_HOST"] ?? "127.0.0.1";
  const pathPrefix = process.env["GROCERIES_MCP_PATH_PREFIX"] ?? "";
  const token = process.env["GROCERIES_MCP_TOKEN"] ?? "";
  await runHttp({ host, port, pathPrefix, token });
} else {
  await runStdio();
}
