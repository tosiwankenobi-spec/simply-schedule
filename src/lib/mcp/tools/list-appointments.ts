import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_appointments",
  title: "List appointments",
  description:
    "List the signed-in user's Chronos-V appointments within an optional time range, ordered by start time.",
  inputSchema: {
    from: z.string().optional().describe("ISO timestamp lower bound for start time. Defaults to now."),
    to: z.string().optional().describe("ISO timestamp upper bound for start time."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("appointments")
      .select("id,title,starts_at,ends_at,location,notes,source")
      .gte("starts_at", from ?? new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit ?? 25);
    if (to) query = query.lte("starts_at", to);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { appointments: data ?? [] },
    };
  },
});
