# Cassini Mission Plan MCP

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server over the Cassini-Huygens mission dataset (~62k activity rows). Built as an AI workshop demo: clean, readable TypeScript that runs live in Claude Desktop.

**Live endpoint:** `https://cassini-mission-plan.redfour.workers.dev`

---

## What it does

Exposes 7 MCP tools so an LLM client can query the Cassini `master_plan` table:

| Tool | What it answers |
|---|---|
| `list_activities` | Filtered, paginated rows (date range, team, target) |
| `get_activity` | Single row by id |
| `search_activities` | FTS5 full-text search over title + description |
| `count_activities` | Row count matching the same filters as list |
| `aggregate_activities` | Group-by counts (team / target / spass_type) |
| `timeline` | Bucketed counts over a date range (year or month) — zero-filled |
| `list_distinct` | Distinct values of team / target / spass_type |

## Architecture

- **Runtime:** Cloudflare Workers (TypeScript)
- **Data:** Cloudflare D1 (SQLite) — `master_plan` table + FTS5 virtual table
- **Transport:** hand-rolled MCP-over-HTTP (JSON-RPC 2.0 over plain HTTP POST)
- **Validation:** zod schemas per tool; errors surface as JSON-RPC error objects

See `docs/ARCHITECTURE.md` for the full design.

## Project setup

```bash
npm install
```

## Run tests

```bash
npm test                  # Jest — all specs against in-memory SQLite
```

The deploy spec (`spec/deploy-and-initialize.spec.ts`) needs a live URL:

```bash
DEPLOY_URL=https://cassini-mission-plan.redfour.workers.dev npm test
```

## Deploy (one-time setup)

1. **Create the D1 database:**
   ```bash
   npx wrangler d1 create cassini
   ```
   Copy the `database_id` into `wrangler.toml`.

2. **Import the data** (generates `data/cassini.d1.sql` from `data/cassini.db`):
   ```bash
   node scripts/import.js      # or: npx ts-node scripts/import.ts
   npx wrangler d1 execute cassini --remote --file=data/cassini.d1.sql
   ```

3. **Deploy:**
   ```bash
   npm run deploy
   ```

## Local dev

```bash
npm run dev   # wrangler dev (uses local D1)
```

## Docs

| File | What's in it |
|---|---|
| `docs/PROJECT.md` | Problem, audience, goals, scope |
| `docs/ARCHITECTURE.md` | Components, data model, key decisions |
| `docs/SPEC.md` | Tool API reference + functional/non-functional requirements |
| `docs/STORIES.md` | User stories (source for the spec suite) |
| `docs/PLAN.md` | Build task checklist (all complete) |
| `docs/MEMORY.md` | Decision log maintained with Claude Code |
