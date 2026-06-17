# MEMORY.md
<!-- Curated by /document; appended to by every phase command -->
<!-- Decisions made with AI, preserved for Claude Code -->

## 📓 Decision Log

### 2026-06-17: Primary audience is the workshop, not end users
Demo for Rob's AI workshop attendees. Drives the "readable reference code"
bar and rules out hosting/multi-user concerns.

### 2026-06-17: Read-only MCP, no writes, no auth, no external enrichment
Scope cut to keep the demo small and the source teachable.

### 2026-06-17: TypeScript + Bun
Matches Rob's default stack and keeps the workshop install story tight.

### 2026-06-17: Single-table dataset (`master_plan`, ~62k rows)
Inspected `data/cassini.db` — one table with time, team, target, title,
description. Tool surface will be shaped around this schema.

### 2026-06-17: Hosting/remote transport deferred, not killed
User did not pick "hosting/deployment" as out-of-scope. Local stdio is the
baseline; remote transport is parked as an open question for `/design`.

### 2026-06-17 (/design): Deploy target is Cloudflare Workers free tier
Hard constraint surfaced in `/design`. Inverts earlier defaults: kills Bun
runtime, kills `bun:sqlite`, kills stdio transport. Drives every decision
below.

### 2026-06-17 (/design): Data store = Cloudflare D1
SQLite-shaped, free tier, native Worker binding. Rejected: bundled .db +
sql.js (cold-start + no FTS5); local-only SQLite (fails deploy target).

### 2026-06-17 (/design): Transport = remote MCP (HTTP/SSE), no stdio shim
Workers can't speak stdio. Claude Desktop supports remote MCP servers
natively, so one path is enough. Rejected: stdio bridge — extra moving
part for marginal demo value.

### 2026-06-17 (/design): MCP framework = Cloudflare agents / workers-mcp
First-party Workers MCP support beats hand-wiring `@modelcontextprotocol/sdk`
over an HTTP shim for a teaching context. Rejected: raw `@mcp/sdk` on
Workers — more glue, more to explain.

### 2026-06-17 (/design): Date normalization materialized at import
`start_iso` column computed once during import and indexed, instead of
parsing DOY strings on every query. Honors the "normalize on read" UX
contract (tools take/return ISO) while fitting the Workers CPU budget.
Rejected: per-query parsing — wasteful at 62k rows.

### 2026-06-17 (/design): No ORM, thin query layer
One table, ~7 read patterns. Drizzle/Prisma would be more code than the
SQL. Rejected: ORM — overkill for a workshop demo.

### 2026-06-17 (/design): zod for tool-arg validation
Cheap path to both runtime safety and the JSON Schema that MCP tool
declarations need.

### 2026-06-17 (/plan): MVP = all 7 tools, no partial release
User chose to ship the full tool catalogue as one slice rather than a
list/get vertical first. Plan still sequences foundation → tools → ship so
each tool is independently reviewable.

### 2026-06-17 (/plan): Test runner = Jest
No package.json or Bun markers present → bdd-specs detection rule defaults
to Jest. NOTE: this is a Cloudflare Workers project where Vitest +
`@cloudflare/vitest-pool-workers` is idiomatic; revisit during T01 scaffold
if Worker-runtime fidelity in tests is needed.

### 2026-06-17 (/plan): Specs drive the exported Worker fetch via a harness
`spec/support/harness.ts` injects an in-memory SQLite at the `Db` port and
routes MCP requests through the production `default.fetch`. Tools are never
tested by calling internals. The deploy spec (STORY-010) bypasses the
harness and hits a real `DEPLOY_URL` — production reality, not mocks.

### 2026-06-17 (/plan): T08 (search) depends on T04 (importer)
FTS5 search can't be specced green without the FTS virtual table the
importer builds. Sequencing: T04 before T08 even though both are "tools era".

### 2026-06-17 (/build-loop): MCP transport = hand-rolled JSON-RPC over HTTP
REVERSES the /design choice of Cloudflare `agents`/workers-mcp. That
framework is Durable-Object based and only runs in the Workers runtime, so
the production `default.fetch` entry point can't be driven from node — which
breaks the `sessionWith` harness and all 10 specs (they POST plain JSON-RPC
through `default.fetch` with an injected in-memory D1). User chose a minimal
hand-rolled MCP-over-HTTP handler at T05: ~100 lines, no Durable Objects,
testable in jest, runs on Workers free tier, and maximally transparent for
the workshop. ARCHITECTURE.md decision row updated; reconcile prose in
/document.
