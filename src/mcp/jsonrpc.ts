/**
 * JSON-RPC 2.0 types and framing helpers.
 *
 * Kept narrow: only the subset needed by the MCP-over-HTTP transport.
 * No external deps; pure types + small pure functions.
 */

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess<T = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: T;
}

export interface JsonRpcError {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
  };
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError;

// ---------------------------------------------------------------------------
// Standard error codes (JSON-RPC 2.0 spec §5.1)
// ---------------------------------------------------------------------------

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

// ---------------------------------------------------------------------------
// Framing helpers
// ---------------------------------------------------------------------------

export function success<T>(
  id: string | number | null,
  result: T,
): JsonRpcSuccess<T> {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Parse + type-guard
// ---------------------------------------------------------------------------

/**
 * Parse and validate the request body as a JSON-RPC 2.0 request object.
 * Returns a typed request or an error response ready to send back.
 */
export function parseRequest(
  raw: unknown,
): { ok: true; req: JsonRpcRequest } | { ok: false; err: JsonRpcError } {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return {
      ok: false,
      err: rpcError(null, RPC_INVALID_REQUEST, "request must be a JSON object"),
    };
  }

  const obj = raw as Record<string, unknown>;

  if (obj["jsonrpc"] !== "2.0") {
    return {
      ok: false,
      err: rpcError(null, RPC_INVALID_REQUEST, 'jsonrpc must be "2.0"'),
    };
  }

  if (typeof obj["method"] !== "string" || obj["method"].length === 0) {
    return {
      ok: false,
      err: rpcError(
        extractId(obj),
        RPC_INVALID_REQUEST,
        "method must be a non-empty string",
      ),
    };
  }

  const id = extractId(obj);

  return {
    ok: true,
    req: {
      jsonrpc: "2.0",
      id,
      method: obj["method"] as string,
      params: obj["params"],
    },
  };
}

function extractId(obj: Record<string, unknown>): string | number | null {
  const id = obj["id"];
  if (typeof id === "string" || typeof id === "number") return id;
  return null;
}
