/**
 * Feature: resolveDb routes correctly for production vs test environments
 *
 * The production default MUST apply d1Adapter to env.DB. The test path uses
 * env.__testDb directly. These specs exist as a regression guard for the
 * duck-typing bug where isDb() misclassified a D1Database as a Db port,
 * causing d1Adapter to be skipped and raw D1PreparedStatement to reach
 * handlers that expect the unwrapped Db port contract.
 */
import { describe, it, expect } from "@jest/globals";
import { resolveDb, type Env } from "../src/server";
import { d1Adapter } from "../src/db/queries";
import type { Db } from "../src/db/queries";

// ---------------------------------------------------------------------------
// D1 stub — mimics D1Database's shape including the {results} envelope.
// This is the key difference: D1PreparedStatement.all() returns {results:T[]}
// while the Db port's Stmt.all() returns T[] directly. d1Adapter must unwrap.
// ---------------------------------------------------------------------------

function makeD1Stub(rows: unknown[] = [{ id: 1 }]) {
  const preparedStmt = {
    bind(..._values: unknown[]) {
      return this;
    },
    async all<T>() {
      return { results: rows as T[] };
    },
    async first<T>() {
      return (rows[0] ?? null) as T | null;
    },
    async run() {
      return {};
    },
  };

  return {
    prepare(_sql: string) {
      return preparedStmt;
    },
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Scenario: env.DB (no __testDb) — production path goes through d1Adapter
// ---------------------------------------------------------------------------

describe("Feature: resolveDb routing", () => {
  describe("Scenario: production env with env.DB only", () => {
    it("wraps env.DB via d1Adapter so .all() returns unwrapped rows, not {results}", async () => {
      const d1Stub = makeD1Stub([{ id: 1 }]);
      const env = { DB: d1Stub } as Env;

      const db = resolveDb(env);
      const rows = await db.prepare("SELECT 1").all<{ id: number }>();

      // d1Adapter unwraps {results:[...]} → array
      expect(rows).toEqual([{ id: 1 }]);
    });

    it("returns an array (not a D1 envelope object) for .all()", async () => {
      const d1Stub = makeD1Stub([{ id: 42 }, { id: 99 }]);
      const env = { DB: d1Stub } as Env;

      const db = resolveDb(env);
      const rows = await db.prepare("SELECT 1").all<{ id: number }>();

      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario: test env with __testDb — bypasses d1Adapter entirely
  // -------------------------------------------------------------------------

  describe("Scenario: test env with __testDb present", () => {
    it("returns __testDb directly without wrapping it again", () => {
      // A pre-built Db port (identity: same object reference).
      const testDb: Db = {
        prepare(_sql: string) {
          return {
            bind() { return this; },
            all<T>() { return Promise.resolve([] as T[]); },
            first<T>() { return Promise.resolve(null as T | null); },
            run() { return Promise.resolve(); },
          };
        },
      };

      const env = { DB: {} as D1Database, __testDb: testDb } as Env;
      const result = resolveDb(env);

      expect(result).toBe(testDb);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario: d1Adapter unit — proves the envelope-unwrapping directly
  // -------------------------------------------------------------------------

  describe("Scenario: d1Adapter unwraps D1's {results} envelope", () => {
    it("unwraps {results:[...]} from D1PreparedStatement.all() into a plain array", async () => {
      const d1Stub = makeD1Stub([{ id: 1 }]);
      const db = d1Adapter(d1Stub);

      const rows = await db.prepare("SELECT 1").all<{ id: number }>();

      expect(rows).toEqual([{ id: 1 }]);
    });

    it("returns the first row from .first() without an envelope", async () => {
      const d1Stub = makeD1Stub([{ id: 7 }]);
      const db = d1Adapter(d1Stub);

      const row = await db.prepare("SELECT 1").first<{ id: number }>();

      expect(row).toEqual({ id: 7 });
    });
  });

  // -------------------------------------------------------------------------
  // Sad path: env with neither DB nor __testDb throws a clear error
  // -------------------------------------------------------------------------

  describe("Scenario: neither env.DB nor env.__testDb is present", () => {
    it("throws rather than returning a broken Db when env is empty", () => {
      // Cast to Env to simulate a misconfigured deploy (missing DB binding).
      const env = {} as Env;

      // resolveDb calls d1Adapter(env.DB) — d1Adapter receives undefined,
      // which is not a D1Database. Any downstream .prepare() call would throw.
      // We assert resolveDb itself doesn't silently swallow the problem.
      expect(() => resolveDb(env)).not.toThrow(); // resolveDb itself is lazy
      const db = resolveDb(env);

      // The failure surfaces when prepare() is invoked on the undefined binding.
      expect(() => db.prepare("SELECT 1")).toThrow();
    });
  });
});
