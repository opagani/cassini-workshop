# ARCHITECTURE.md
<!-- Owner: /design — do not edit manually -->

## 🏗️ Overview

A **remote MCP server** running on a single **Cloudflare Worker**, backed by
**Cloudflare D1** (managed SQLite). It exposes the Cassini `master_plan`
dataset as a small, well-named set of MCP tools an LLM client can call over
plain HTTP (JSON-RPC 2.0 POST). No writes, no auth, no external services.

```
Claude Desktop / MCP client
        │  HTTP (JSON-RPC 2.0 POST)
        ▼
┌──────────────────────────┐
│  Cloudflare Worker (TS)  │
│  ─ MCP transport         │
│  ─ Tool registry         │
│  ─ Query layer           │
└──────────────────────────┘
        │  D1 binding
        ▼
┌──────────────────────────┐
│  D1 (SQLite)             │
│  ─ master_plan           │
│  ─ master_plan_fts (FTS5)│
└──────────────────────────┘
```

## 📦 Components

| Component | Responsibility | Lives in |
|---|---|---|
| **Transport** | MCP wire protocol — JSON-RPC 2.0 over HTTP POST | `src/server.ts` |
| **JSON-RPC helpers** | Request parsing, response builders, error codes | `src/mcp/jsonrpc.ts` |
| **Tool registry** | Declares zod schemas, JSON Schema conversion, handler dispatch | `src/tools/index.ts` |
| **Tool handlers** | All 7 handlers in one file — parses args, calls query layer, returns result | `src/tools/index.ts` |
| **Query layer** | Typed, prepared-statement wrappers around D1 SQL. No tool logic. | `src/db/queries.ts` |
| **Schema DDL** | Single source of truth for table + indexes + FTS — used by both importer and tests | `src/db/schema.ts` |
| **Date utils** | Convert mission DOY format (`YYYY-DDDThh:mm:ss`) ↔ ISO 8601 | `src/util/dates.ts` |
| **Version** | Semantic version reported in `initialize` response (SPEC N6) | `src/version.ts` |
| **Importer** | One-shot script: load `data/cassini.db` → D1, derive `start_iso`, build FTS | `scripts/import.ts` |

**Boundaries (why this split):** the tool registry is the only thing that
knows MCP exists; the query layer is the only thing that knows SQL exists.
Swapping transport touches one file; swapping D1 for something else touches
one file. This is the "design-for-change" bet.

## 🔄 Data Flow

1. Client POSTs a JSON-RPC 2.0 request to the Worker URL.
2. `default.fetch` parses the body; bad JSON → parse error, not 500.
3. Dispatches on method: `initialize`, `tools/list`, or `tools/call`.
4. For `tools/call`: resolves the D1 adapter, finds the handler in the registry.
5. Handler validates args with zod (ZodError → `INVALID_PARAMS`), calls the query function.
6. Query layer issues a prepared D1 statement with bound params, returns typed rows.
7. Handler returns the result; server wraps it as MCP text content and JSON-RPC success.
8. Unexpected errors → `console.error` + generic `"internal error"` (no internals leaked).

All synchronous request/response — no SSE, no jobs, no queues.

## 🗄️ Data Model

Single source table imported as-is, plus one derived column and one FTS
virtual table:

```sql
-- canonical table (mirrors the source schema)
CREATE TABLE master_plan (
  id              INTEGER PRIMARY KEY,
  start_time_utc  TEXT,    -- raw mission DOY string e.g. '2004-135T18:40:00'
  start_iso       TEXT,    -- 🆕 derived ISO 8601 e.g. '2004-05-14T18:40:00Z'
  duration        TEXT,    -- e.g. '000T09:22:00'
  date            TEXT,    -- e.g. '14-May-04'
  team            TEXT,
  spass_type      TEXT,
  target          TEXT,
  request_name    TEXT,
  library_definition TEXT,
  title           TEXT,
  description     TEXT
);

CREATE INDEX idx_master_plan_start_iso ON master_plan(start_iso);
CREATE INDEX idx_master_plan_team      ON master_plan(team);
CREATE INDEX idx_master_plan_target    ON master_plan(target);

-- FTS5 over searchable text
CREATE VIRTUAL TABLE master_plan_fts USING fts5(
  title, description, content='master_plan', content_rowid='id'
);
```

**Date strategy:** computed at import time, not at query time.
~62k rows × per-request parsing on Workers' tight CPU budget is a bad
trade vs. one indexed column. LLM tools still accept ISO in/out, so the
"normalize on read" UX promise from `/explore` holds — the work just
happens once during import.

## ⚙️ Key Decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| **Cloudflare Workers + D1** | Free-tier deploy is the hard constraint. D1 is SQLite-shaped → near-zero schema work. | Bun + `bun:sqlite` locally hosted — fails the deploy requirement. |
| **Hand-rolled JSON-RPC-over-HTTP MCP handler** (was: `agents`/workers-mcp — reversed in /build-loop) | `agents`/workers-mcp is Durable-Object based, only runs in the Workers runtime, so `default.fetch` can't be driven from node — breaks the test harness + all specs. A ~100-line plain `fetch` handler is testable in jest, runs on the free tier, and is the most transparent thing to teach. | `agents`/workers-mcp (DO-based, untestable via default.fetch in node); `@modelcontextprotocol/sdk` (Node-oriented transports need a Workers shim). |
| **HTTP/SSE only, no stdio shim** | Workers can't speak stdio; Claude Desktop already supports remote MCP servers. Keep one path. | stdio bridge — extra moving part for marginal demo value. |
| **D1 instead of bundled sql.js** | 62k rows is past the sweet spot for sql.js cold starts; D1 indexes are free. | Bundle `.db` as a Worker asset with sql.js — viable, slower, no FTS5. |
| **Materialized `start_iso` column at import** | Indexable, cheap at query time, fits Workers' CPU budget. | Parse DOY format on every query — wasteful at 62k rows. |
| **Thin query layer, no ORM** | One table, ~7 read patterns. An ORM is more code than the SQL. | Drizzle — overkill for a workshop demo over one table. |
| **zod for tool arg validation** | MCP tool schemas need JSON Schema; zod → JSON Schema is a one-liner and gives runtime safety. | Hand-rolled validators — duplicate work. |
| **No auth** | Public, read-only, free-tier scope. Cloudflare rate-limits the endpoint. | Bearer token — out of scope per `/explore`. |

## ⚠️ Risks & Fallbacks

| Risk | Status / Fallback |
|---|---|
| D1 free-tier query limits hit during the demo | **Mitigated:** `list_distinct` caches per isolate (T12); other tools have result caps (SPEC F4). |
| FTS5 not available on D1 free tier | **Confirmed working** — D1 import loaded with 247k rows written including the FTS index; live `search_activities` returns ranked snippets. |
| `start_time_utc` parse edge cases (malformed rows) | Importer skips + logs bad rows; 0 skipped on the real 61,873-row dataset. |
| Claude Desktop remote MCP config friction on stage | Pre-recorded fallback + a one-page setup card for attendees. |

## 📝 Open items

- Workshop date / demo script — parked, no decision made.
