/**
 * Cassini Mission Plan MCP — Worker entry point.
 *
 * Implements MCP-over-HTTP as a hand-rolled JSON-RPC 2.0 handler.
 * No Durable Objects. No framework. A plain `default.fetch` that:
 *   - Parses a JSON-RPC request from the POST body (gracefully on bad input).
 *   - Dispatches to one of the three MCP methods.
 *   - Returns a well-formed JSON-RPC response every time.
 *
 * Testable: call `default.fetch(request, env)` from Node/Jest by passing
 * a pre-built `Db` on env (see `resolveDb` below).
 */

import { VERSION } from "./version";
import { toolDescriptors, toolHandlers } from "./tools/index";
import type { Db } from "./db/queries";
import { d1Adapter } from "./db/queries";
import { ZodError } from "zod";
import {
  parseRequest,
  success,
  rpcError,
  RPC_PARSE_ERROR,
  RPC_METHOD_NOT_FOUND,
  RPC_INVALID_PARAMS,
  RPC_INTERNAL_ERROR,
  type JsonRpcResponse,
} from "./mcp/jsonrpc";

// ---------------------------------------------------------------------------
// Env type
// ---------------------------------------------------------------------------

/**
 * Production env: `DB` is a live Cloudflare D1Database binding.
 *
 * `__testDb` is a named test seam — specs inject a pre-built `Db` port here
 * (better-sqlite3 adapter) so they never touch `DB`. The two keys are
 * deliberately distinct: no duck-typing, no accidental aliasing.
 * `__testDb` MUST NOT appear in production; it is stripped by the test
 * harness before any real deploy.
 */
export interface Env {
  /** Live D1 binding — present in production and Wrangler dev. */
  readonly DB: D1Database;
  /** Test-only: a pre-built Db port injected by spec/support/harness.ts. */
  readonly __testDb?: Db;
}

// ---------------------------------------------------------------------------
// Db resolution — production default is d1Adapter; test path is explicit
// ---------------------------------------------------------------------------

/**
 * Return the `Db` port for this request.
 *
 * Resolution order (first match wins):
 *   1. `env.__testDb` — a pre-built port injected by the test harness.
 *   2. `env.DB` — the live D1 binding, wrapped via `d1Adapter`.
 *
 * Production always takes path 2. Path 1 is only reachable from tests.
 * There is NO duck-typing: the test path requires an explicit opt-in key.
 */
export function resolveDb(env: Env): Db {
  if (env.__testDb !== undefined) return env.__testDb;
  return d1Adapter(env.DB);
}

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

function handleInitialize(): Record<string, unknown> {
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "cassini-mission-plan", version: VERSION },
  };
}

function handleToolsList(): Record<string, unknown> {
  return { tools: toolDescriptors };
}

async function handleToolsCall(
  params: unknown,
  db: Db,
): Promise<Record<string, unknown>> {
  if (
    typeof params !== "object" ||
    params === null ||
    typeof (params as Record<string, unknown>)["name"] !== "string"
  ) {
    throw { isRpcError: true, code: RPC_INVALID_PARAMS, message: "params.name is required" };
  }

  const { name, arguments: args } = params as {
    name: string;
    arguments?: unknown;
  };

  const handler = toolHandlers[name];
  if (handler === undefined) {
    throw {
      isRpcError: true,
      code: RPC_METHOD_NOT_FOUND,
      message: `unknown tool: ${name}`,
    };
  }

  // Call the handler — it validates its own args via zod.
  const result = await handler(args ?? {}, db);

  // Wrap in MCP tool result content (text JSON).
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: false,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // GET / (and HEAD) — a friendly health/info page so browser visits and
    // uptime probes get a useful 200 instead of a bare 405. The MCP protocol
    // itself is POST-only; this is purely human/monitoring affordance.
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      if (url.pathname === "/") {
        const info = {
          name: "cassini-mission-plan",
          version: VERSION,
          status: "ok",
          transport: "MCP-over-HTTP (JSON-RPC 2.0)",
          usage: `POST ${url.origin}/ with a JSON-RPC body, e.g. {"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
          tools: toolDescriptors.length,
        };
        return new Response(JSON.stringify(info, null, 2), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // Only accept POST — any other method gets a 405 outside JSON-RPC framing
    // because there is no request id to echo back yet.
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Parse body as JSON — any parse failure → JSON-RPC parse error.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        rpcError(null, RPC_PARSE_ERROR, "invalid JSON in request body"),
      );
    }

    // Validate JSON-RPC envelope.
    const parsed = parseRequest(body);
    if (!parsed.ok) {
      return jsonResponse(parsed.err);
    }

    const { req } = parsed;

    // Dispatch MCP methods.
    try {
      let result: Record<string, unknown>;

      switch (req.method) {
        case "initialize":
          result = handleInitialize();
          break;

        case "tools/list":
          result = handleToolsList();
          break;

        case "tools/call": {
          const db = resolveDb(env);
          result = await handleToolsCall(req.params, db);
          break;
        }

        default:
          return jsonResponse(
            rpcError(req.id, RPC_METHOD_NOT_FOUND, `method not found: ${req.method}`),
          );
      }

      return jsonResponse(success(req.id, result));
    } catch (err: unknown) {
      // Structured RPC errors thrown by handleToolsCall — safe, user-facing.
      if (isRpcThrow(err)) {
        return jsonResponse(rpcError(req.id, err.code, err.message));
      }

      // Zod validation errors — safe to surface; they describe bad user input.
      if (err instanceof ZodError) {
        const message = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        return jsonResponse(rpcError(req.id, RPC_INVALID_PARAMS, message));
      }

      // Any other error (DB failure, unexpected runtime crash) — log server-side,
      // return a generic message so internal details don't leak to callers.
      console.error("[cassini-mcp] unexpected error:", err);
      return jsonResponse(rpcError(req.id, RPC_INTERNAL_ERROR, "internal error"));
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RpcThrow {
  isRpcError: true;
  code: number;
  message: string;
}

function isRpcThrow(err: unknown): err is RpcThrow {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<string, unknown>)["isRpcError"] === true
  );
}

function jsonResponse(body: JsonRpcResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
