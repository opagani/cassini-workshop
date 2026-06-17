/**
 * Tool registry — the single source of truth for all 7 MCP tools.
 *
 * Layout:
 *   - Zod schemas (one per tool) — validate args at the boundary.
 *   - toolDescriptors — the MCP `tools/list` payload, derived from schemas.
 *   - toolHandlers — dispatch map from tool name → handler.
 *
 * Adding a tool (tasks T06–T12):
 *   1. Add a zod schema below.
 *   2. Add an entry to `toolDescriptors` (name + description + inputSchema).
 *   3. Replace the stub in `toolHandlers` with the real handler.
 *   Nothing else needs changing.
 */

import { z } from "zod";
import type { Db } from "../db/queries";

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const isoDatetime = z.string().datetime({ offset: true }).optional();
const teamFilter = z.string().optional();
const targetFilter = z.string().optional();
const spassTypeFilter = z.string().optional();

// Shared filters reused across multiple tools.
const listFilters = {
  from: isoDatetime,
  to: isoDatetime,
  team: teamFilter,
  target: targetFilter,
  spass_type: spassTypeFilter,
};

// ---------------------------------------------------------------------------
// Per-tool zod schemas
// ---------------------------------------------------------------------------

const listActivitiesSchema = z.object({
  ...listFilters,
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const getActivitySchema = z.object({
  id: z.number().int(),
});

const searchActivitiesSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().min(1).max(50).default(10),
});

const countActivitiesSchema = z.object({
  ...listFilters,
});

const aggregateActivitiesSchema = z.object({
  group_by: z.enum(["team", "target", "spass_type"]),
  ...listFilters,
  top: z.number().int().min(1).max(100).default(20),
});

const timelineSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  bucket: z.enum(["year", "month"]).default("year"),
  team: teamFilter,
  target: targetFilter,
});

const listDistinctSchema = z.object({
  field: z.enum(["team", "target", "spass_type"]),
});

// ---------------------------------------------------------------------------
// MCP tool descriptors (tools/list response)
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/**
 * Convert a zod schema to a minimal JSON Schema object for the MCP
 * `tools/list` response. We derive the shape from zod's introspection
 * rather than hand-writing JSON Schema, keeping schemas in one place.
 */
function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Use zod's internal shape for object schemas to build a JSON Schema object.
  // This is intentionally minimal — only what MCP clients need to call tools.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, field] of Object.entries(shape)) {
      properties[key] = fieldToJsonSchema(field);
      // A field is required unless it is optional or has a default.
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    const schema_: Record<string, unknown> = {
      type: "object",
      properties,
    };
    if (required.length > 0) schema_["required"] = required;
    return schema_;
  }
  return { type: "object" };
}

function fieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  // Unwrap ZodDefault → inner type, ZodOptional → inner type.
  if (field instanceof z.ZodDefault) {
    return fieldToJsonSchema(field._def.innerType as z.ZodTypeAny);
  }
  if (field instanceof z.ZodOptional) {
    return fieldToJsonSchema(field._def.innerType as z.ZodTypeAny);
  }
  if (field instanceof z.ZodString) return { type: "string" };
  if (field instanceof z.ZodNumber) return { type: "number" };
  if (field instanceof z.ZodEnum) {
    return { type: "string", enum: field._def.values as string[] };
  }
  return {};
}

export const toolDescriptors: readonly ToolDescriptor[] = [
  {
    name: "list_activities",
    description:
      "Return filtered, paginated rows from the Cassini master plan. " +
      "Supports date range, team, target, and spass_type filters.",
    inputSchema: toJsonSchema(listActivitiesSchema),
  },
  {
    name: "get_activity",
    description: "Fetch a single Cassini mission activity by its integer id.",
    inputSchema: toJsonSchema(getActivitySchema),
  },
  {
    name: "search_activities",
    description:
      "Full-text search over activity title and description. " +
      "Returns matches ranked by FTS5 relevance with a snippet.",
    inputSchema: toJsonSchema(searchActivitiesSchema),
  },
  {
    name: "count_activities",
    description:
      "Count activities matching filters without returning rows. " +
      "Use before paginating with list_activities.",
    inputSchema: toJsonSchema(countActivitiesSchema),
  },
  {
    name: "aggregate_activities",
    description:
      "Group activities by team, target, or spass_type and return counts, " +
      "sorted descending. Useful for 'which team was most active'.",
    inputSchema: toJsonSchema(aggregateActivitiesSchema),
  },
  {
    name: "timeline",
    description:
      "Bucket activity counts over a date range by year or month. " +
      "Buckets with zero activity are included so the LLM sees the full span.",
    inputSchema: toJsonSchema(timelineSchema),
  },
  {
    name: "list_distinct",
    description:
      "Return the sorted, distinct values for a column: team, target, or spass_type. " +
      "Results are cached per isolate for the lifetime of the Worker.",
    inputSchema: toJsonSchema(listDistinctSchema),
  },
];

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type ToolHandler = (args: unknown, db: Db) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Dispatch map  (tool tasks T06–T12 replace the stubs)
// ---------------------------------------------------------------------------

function notImplemented(name: string): ToolHandler {
  return async () => {
    throw new Error(`${name}: not implemented`);
  };
}

export const toolHandlers: Readonly<Record<string, ToolHandler>> = {
  list_activities: notImplemented("list_activities"),
  get_activity: notImplemented("get_activity"),
  search_activities: notImplemented("search_activities"),
  count_activities: notImplemented("count_activities"),
  aggregate_activities: notImplemented("aggregate_activities"),
  timeline: notImplemented("timeline"),
  list_distinct: notImplemented("list_distinct"),
};

// Re-export schemas so tool tasks can import the zod schema for their tool
// without re-declaring it. Each task imports the schema it owns.
export {
  listActivitiesSchema,
  getActivitySchema,
  searchActivitiesSchema,
  countActivitiesSchema,
  aggregateActivitiesSchema,
  timelineSchema,
  listDistinctSchema,
};
