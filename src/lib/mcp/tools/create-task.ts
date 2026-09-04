import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "create_task",
  title: "Create task",
  description: "Add a task to the signed-in user's Chronos-V backlog.",
  inputSchema: {
    title: z.string().trim().min(1),
    estimated_min: z.number().int().min(5).max(600).optional().describe("Estimated minutes (default 30)."),
    priority: z.number().int().min(1).max(5).optional().describe("1 (low) to 5 (high)."),
    energy: z.enum(["low", "medium", "high"]).optional(),
    deadline: z.string().optional().describe("ISO 8601 deadline timestamp."),
    notes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, estimated_min, priority, energy, deadline, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: ctx.getUserId()!,
        title,
        estimated_min: estimated_min ?? 30,
        priority: priority ?? 3,
        energy: energy ?? "medium",
        deadline: deadline ?? null,
        notes: notes ?? null,
      })
      .select("id,title,status,priority,energy,estimated_min,deadline")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { task: data },
    };
  },
});
