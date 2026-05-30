# Contributing

Thanks for improving `groceries-mcp`. This repo is intentionally small, so the
quality bar is mostly about keeping changes easy to review and avoiding surprise
breakage for MCP clients.

## Local Checks

Run the checks that match your change:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run repo-hygiene
```

Each check also runs as its own GitHub PR check, so failures should be easy to
spot from the PR UI or `gh pr checks`.

Use `npm run format` to apply Prettier formatting.

## Scraper Changes

Live retailer pages are too flaky for required PR CI. If you add or change a
scraper, include manual evidence in the PR description instead:

- Store
- Command run
- ZIP/store ID used
- Date/time run
- Result count
- Sample redacted output
- Known limitations or flaky steps

Prefer deterministic unit tests for parser, dispatcher, model, and repo-hygiene
behavior. Use live scraper evidence to show the browser/API flow worked in the
real world.

## Compatibility

Call out any MCP tool name, input schema, or response shape changes in the PR.
When possible, keep old response fields alongside new ones for at least one
release so existing clients do not break silently.
