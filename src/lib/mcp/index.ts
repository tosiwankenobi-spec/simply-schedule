import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAppointments from "./tools/list-appointments";
import createAppointment from "./tools/create-appointment";
import listTasks from "./tools/list-tasks";
import createTask from "./tools/create-task";
import completeTask from "./tools/complete-task";

const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "chronos-v",
  title: "Chronos-V",
  version: "0.1.0",
  instructions:
    "Tools for Chronos-V, an AI schedule planner. Read and create appointments on the signed-in user's schedule, and manage their task backlog. Always confirm times in the user's local timezone before creating appointments.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAppointments, createAppointment, listTasks, createTask, completeTask],
});
