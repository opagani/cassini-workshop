/**
 * Spec harness — the seam every spec drives the system through.
 *
 * CONTRACT (implemented by T01 + T05; stub throws until then, so specs are RED):
 *
 * Specs never call internal functions. They build an MCP JSON-RPC request and
 * push it through the PRODUCTION entry point — `default.fetch` from
 * `src/server.ts` — with an in-memory SQLite store injected at the `Db`
 * boundary (the same port D1 implements in production). Mocks define test
 * reality; this entry-point path defines production reality.
 *
 * Implement against this signature; do not change the signatures without
 * updating the specs that depend on them.
 */
import type { Row } from "./fixtures";
import { createTestDb } from "./db";
import server from "../../src/server";

/** MCP error surfaced by a tool call — code is the JSON-RPC error code. */
export class McpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** A live MCP session bound to the exported Worker `fetch`, backed by `rows`. */
export interface Session {
  /** Result of the MCP `initialize` handshake. */
  initialize(): Promise<{ serverInfo: { name: string; version: string } }>;
  /** Tool names from `tools/list`. */
  listTools(): Promise<string[]>;
  /** Call a tool; resolves to its structured result or throws `McpError`. */
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * Build a session whose store is seeded with `rows`.
 * Implementation: create an in-memory SQLite (schema + FTS per
 * ARCHITECTURE.md), insert rows, wrap as the `Db` port, inject into the
 * Worker `env`, and route requests through `app.fetch`.
 */
export function sessionWith(rows: Row[]): Session {
  const db = createTestDb(rows);
  // Inject via the named test seam — resolveDb() uses __testDb directly,
  // bypassing d1Adapter. DB is not set here; it is only used in production.
  const env = { __testDb: db };

  /** POST a JSON-RPC request and return the parsed response body. */
  async function post(method: string, params?: unknown): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await server.fetch(request, env as Parameters<typeof server.fetch>[1]);
    return response.json();
  }

  return {
    async initialize() {
      const resp = await post("initialize") as {
        result: { serverInfo: { name: string; version: string } };
      };
      return { serverInfo: resp.result.serverInfo };
    },

    async listTools() {
      const resp = await post("tools/list") as {
        result: { tools: Array<{ name: string }> };
      };
      return resp.result.tools.map((t) => t.name);
    },

    async callTool<T = unknown>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const resp = await post("tools/call", { name, arguments: args }) as {
        result?: { content: Array<{ type: string; text: string }>; isError: boolean };
        error?: { code: number; message: string };
      };

      if (resp.error !== undefined) {
        throw new McpError(resp.error.code, resp.error.message);
      }

      // Unwrap the text content back to the structured payload.
      const content = resp.result?.content?.[0];
      if (content === undefined || content.type !== "text") {
        throw new McpError(-32603, "unexpected tool result shape");
      }

      return JSON.parse(content.text) as T;
    },
  };
}
