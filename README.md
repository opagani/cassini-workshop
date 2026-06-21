# Cassini Mission Plan MCP

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server over the Cassini-Huygens mission dataset (~62k activity rows). Built as an AI workshop demo: clean, readable TypeScript that runs live in Claude Desktop.

**Live endpoint:** `https://cassini-mission-plan.redfour.workers.dev`

🩺 A plain `GET /` returns a JSON health/info page. The MCP protocol itself is **POST-only** JSON-RPC, so any other request gets a `405`.

```bash
# Health check
curl https://cassini-mission-plan.redfour.workers.dev

# List the tools (JSON-RPC over POST)
curl -X POST https://cassini-mission-plan.redfour.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

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
   npm run import      # tsx scripts/import.ts → writes data/cassini.d1.sql
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

## 🔎 Query the data directly

The local D1 starts **empty** — seed it once from the generated SQL:

```bash
npx wrangler d1 execute cassini --local --file=data/cassini.d1.sql
```

Then run SQL against the `master_plan` table (drop `--local` for `--remote` to hit the deployed DB):

```bash
# Top science teams by activity count
npx wrangler d1 execute cassini --local \
  --command="SELECT team, COUNT(*) AS activities FROM master_plan GROUP BY team ORDER BY activities DESC LIMIT 5;"

# Full-text search via the FTS5 table
npx wrangler d1 execute cassini --local \
  --command="SELECT id, title FROM master_plan_fts JOIN master_plan USING(rowid) WHERE master_plan_fts MATCH 'titan flyby' LIMIT 5;"

# Activities targeting Enceladus, earliest first
npx wrangler d1 execute cassini --local \
  --command="SELECT start_iso, title FROM master_plan WHERE target='Enceladus' ORDER BY start_iso LIMIT 5;"
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
