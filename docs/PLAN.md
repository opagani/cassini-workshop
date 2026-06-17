# PLAN.md
<!-- Owner: /plan — do not edit manually -->

Build order for the Cassini Mission Plan MCP. One task = one reviewable,
committable unit. `build-loop` executes top-to-bottom; tasks in the same
`parallel-group:` have no ordering between them.

MVP = all 7 tools (no partial release). FTS5 assumed available on D1.

## ✅ Tasks

### Group A — Project setup (no deps)

- [x] **T01 — Scaffold Worker project** · story:STORY-001 · depends-on:none · parallel-group:A
  `package.json`, `tsconfig.json`, `wrangler.toml` (Worker + D1 binding),
  Jest config, `src/` layout per ARCHITECTURE.md. Acceptance: `npx jest`
  runs (0 tests ok), `wrangler` recognizes the config.

### Group B — Data + shared seams (depend on T01)

- [x] **T02 — Date utils (DOY ↔ ISO)** · story:STORY-002 · depends-on:T01 · parallel-group:B
  `src/util/dates.ts`: parse `YYYY-DDDThh:mm:ss` → ISO 8601 `Z`, and back.
  Acceptance: spec `doy-to-iso` green.
- [x] **T03 — Query layer interface + D1 adapter** · story:STORY-003 · depends-on:T01 · parallel-group:B
  `src/db/queries.ts`: typed, prepared-statement wrappers (no SQL string
  concat). Define a `Db` port so tests inject a fake. Acceptance: compiles,
  fake adapter usable from specs.

### Group C — Importer (depends on T02, T03)

- [x] **T04 — Importer script** · story:STORY-002 · depends-on:T02,T03 · parallel-group:-
  `scripts/import.ts`: create schema + indexes + `master_plan_fts`, derive
  `start_iso`, skip+log unparseable rows, idempotent re-run. Acceptance:
  specs `seed-d1-from-cassini` green against a local D1/SQLite.

### Group D — MCP transport surface (depends on T01)

- [x] **T05 — Worker MCP transport + tool registry** · story:STORY-001 · depends-on:T01 · parallel-group:-
  `src/server.ts` + `src/tools/index.ts`: `initialize` returns versioned
  `serverInfo`; `tools/list` returns the 7 names (handlers may be stubs that
  throw "not implemented"); unknown tool → MCP error. Acceptance: specs
  `worker-mcp-transport` green via the exported `fetch` handler.

### Group E — Tools (each depends on T03 query layer + T05 registry)

_All parallel — each adds one handler file + registers it. Shared files
(`queries.ts`, `tools/index.ts`) are append-only per task; re-slice if two
tasks edit the same lines._

- [ ] **T06 — list_activities** · story:STORY-003 · depends-on:T03,T05 · parallel-group:E
- [ ] **T07 — get_activity** · story:STORY-004 · depends-on:T03,T05 · parallel-group:E
- [ ] **T08 — search_activities (FTS5)** · story:STORY-005 · depends-on:T03,T05,T04 · parallel-group:E
- [ ] **T09 — count_activities** · story:STORY-006 · depends-on:T03,T05 · parallel-group:E
- [ ] **T10 — aggregate_activities** · story:STORY-007 · depends-on:T03,T05 · parallel-group:E
- [ ] **T11 — timeline (zero-fill buckets)** · story:STORY-008 · depends-on:T03,T05 · parallel-group:E
- [ ] **T12 — list_distinct (isolate cache)** · story:STORY-009 · depends-on:T03,T05 · parallel-group:E

Each T06–T12 acceptance: the tool's spec file green, including sad-path
validation (zod) and the entry-point scenario driving the exported handler.

### Group F — Ship (depends on all tools)

- [ ] **T13 — wire: deploy to Cloudflare + curl initialize** · story:STORY-010 · depends-on:T06,T07,T08,T09,T10,T11,T12 · parallel-group:-
  Real `wrangler deploy`; curl a live `initialize` and `tools/list` against
  the `*.workers.dev` URL. Acceptance: spec `deploy-and-initialize` — a real
  request through the deployed Worker returns versioned `serverInfo` and the
  7 tool names. **Not green-via-mocks.**

## 🔀 Concurrency map

```
T01
 ├─ T02 ┐
 ├─ T03 ┼─ T04 ─┐
 └─ T05 ─────────┼─ T06..T12 (parallel) ─ T13
                 └─ (T08 also needs T04)
```

First parallel group after setup: **B** (T02, T03). Biggest fan-out:
**E** (T06–T12, seven tools at once).
