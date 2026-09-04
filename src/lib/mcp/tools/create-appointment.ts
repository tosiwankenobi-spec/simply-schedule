import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "create_appointment",
  title: "Create appointment",
  description: "Create a new appointment on the signed-in user's Chronos-V schedule.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Appointment title."),
    starts_at: z.string().describe("ISO 8601 start timestamp."),
    ends_at: z.string().optional().describe("ISO 8601 end timestamp."),
    location: z.string().optional(),
    notes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, starts_at, ends_at, location, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("appointments")
      .insert({
        user_id: ctx.getUserId()!,
        title,
        starts_at,
        ends_at: ends_at ?? null,
        location: location ?? null,
        notes: notes ?? null,
        source: "mcp",
      })
      .select("id,title,starts_at,ends_at,location,notes")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { appointment: data },
    };
  },
});
