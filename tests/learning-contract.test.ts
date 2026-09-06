/**
 * Server- and source-contract tests for the learning layer.
 * These assert the privacy and safety guarantees that must hold in the source:
 * user scoping, allowlisted columns, post-success-only recording, best-effort
 * failure behaviour, and an exact reset scope.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const fns = read("src/lib/learning.functions.ts");
const recorder = read("src/lib/learning.server.ts");
const planner = read("src/lib/planner.functions.ts");
const replan = read("src/lib/replan.functions.ts");
const panel = read("src/components/LearningPanel.tsx");
const plannerUi = read("src/routes/_authenticated/planner.tsx");
const migration = read(
  "supabase/migrations/20260906120426_042c012b-cd42-4172-bdcc-befeb90971ed.sql",
);

describe("learning server contract", () => {
  it("requires an authenticated session and never trusts a submitted user id", () => {
    expect(fns).toContain("requireSupabaseAuth");
    expect(fns).toContain("context.userId");
    expect(fns).not.toMatch(/userId:\s*z\./);
  });

  it("scopes every learning query to the session user", () => {
    for (const table of ["learning_settings", "learning_events"]) {
      const uses = fns.split(`.from("${table}")`).slice(1);
      expect(uses.length).toBeGreaterThan(0);
      for (const chunk of uses) {
        expect(chunk.slice(0, 400)).toMatch(
          /user_id["']?[,:]\s*context\.userId|\.eq\("user_id", context\.userId\)/,
        );
      }
    }
  });

  it("selects only allowlisted, non-identifying columns", () => {
    const selects = [...fns.matchAll(/\.select\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(selects.length).toBeGreaterThan(0);
    const forbidden = ["title", "notes", "location", "email", "id,", "task_id", "appointment_id"];
    for (const select of selects) {
      for (const term of forbidden) expect(select).not.toContain(term);
    }
  });

  it("uses no AI call", () => {
    expect(fns + recorder).not.toMatch(/lovable|openai|gemini|LOVABLE_API_KEY/i);
  });

  it("resets through an RPC scoped to learning data only", () => {
    expect(fns).toContain('db.rpc("reset_learning_data")');
    for (const table of [
      "appointments",
      "tasks",
      "plan_runs",
      "planner_profiles",
      "sync_settings",
    ]) {
      expect(fns).not.toContain(`.from("${table}")`);
    }
  });
});

describe("recording hooks", () => {
  it("never throws: recording is best-effort and observable only in development", () => {
    expect(recorder).toContain("} catch {");
    expect(recorder).toContain('process.env["NODE_ENV"] !== "production"');
    expect(recorder).not.toMatch(
      /console\.(log|warn|error)\([^)]*signal\.(offered|approved|moved)/,
    );
  });

  it("sends only allowlisted fields", () => {
    const allowed = [
      "p_kind",
      "p_conflict_strategy",
      "p_offered",
      "p_approved",
      "p_moved",
      "p_restored",
      "p_left_alone",
    ];
    const params = [...recorder.matchAll(/p_[a-z_]+/g)].map((m) => m[0]);
    for (const p of params) expect(allowed).toContain(p);
  });

  it("records a plan only after the appointments insert succeeded", () => {
    const chunks = planner.split("recordLearningSignal(context.supabase, {").slice(1);
    expect(chunks).toHaveLength(2);
    for (const before of planner.split("recordLearningSignal(context.supabase, {").slice(0, -1)) {
      expect(before.slice(-260)).toContain("if (error) throw error;");
    }
  });

  it("counts every offered plan item exactly once", () => {
    expect(planner).toContain("offered: result.accepted.length + result.skipped.length");
    expect(planner).not.toContain(
      "result.accepted.length + result.skipped.length + result.shifted.length",
    );
  });

  it("records replan and undo aggregates without item identities", () => {
    expect(replan).toContain('kind: "replan_applied"');
    expect(replan).toContain('kind: "undo_completed"');
    const signalBlocks = [
      ...replan.matchAll(/recordLearningSignal\(context\.supabase, \{[\s\S]*?\}\);/g),
    ].map((m) => m[0]);
    expect(signalBlocks).toHaveLength(2);
    for (const block of signalBlocks) {
      expect(block).not.toMatch(/appointmentId|title|notes|planRunId|previewId/);
    }
  });

  it("does not record previews or cancelled dialogs", () => {
    const previewChunk = replan.slice(
      replan.indexOf("export const previewDayReplan"),
      replan.indexOf("export const applyDayReplan"),
    );
    expect(previewChunk).not.toContain("recordLearningSignal");
    expect(planner).not.toMatch(/previewDayPlan[\s\S]{0,1200}recordLearningSignal/);
  });
});

describe("learning UI", () => {
  it("keeps accept explicit and never mutates a schedule", () => {
    expect(panel).toContain("acceptLearnedStrategy");
    expect(panel).toContain("clearLearnedStrategy");
    expect(panel).toContain("AlertDialog");
    expect(panel).toContain("Delete learning data");
    expect(panel).not.toMatch(/applyDayPlan|applyWeekPlan|applyDayReplan/);
  });

  it("shows the evidence count and percentage", () => {
    expect(panel).toContain("suggestion.count");
    expect(panel).toContain("suggestion.percent");
  });

  it("dismisses a suggestion without changing a setting", () => {
    expect(panel).toContain("setDismissedSuggestion(suggestionKey)");
    expect(panel).toContain("Suggestion dismissed for now");
  });

  it("preselects the learned default without clobbering the current draft", () => {
    expect(plannerUi).toContain("function useResolution()");
    expect(plannerUi).toContain("if (touched) return;");
    expect(plannerUi).toContain("learning?.enabled ? learning.acceptedStrategy : null");
    expect(plannerUi).toContain("acceptedStrategy");
  });
});

describe("learning migration", () => {
  it("enables RLS with owner-only policies and explicit grants", () => {
    for (const table of ["learning_settings", "learning_events"]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`GRANT ALL ON public.${table} TO service_role`);
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM anon`);
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM authenticated`);
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC`);
    }
    expect(migration).toContain("(SELECT auth.uid()) = user_id");
    expect(migration).toContain("ON DELETE CASCADE");
  });

  it("bounds retention and indexes only user/time access", () => {
    expect(migration).toContain("interval '180 days'");
    expect(migration).toContain("learning_events_user_created_idx");
    expect(migration).toContain("(user_id, created_at DESC)");
    expect(migration).toContain("chronos_v_purge_learning_events");
  });

  it("validates enums and ranges in SQL and derives the user from auth.uid()", () => {
    expect(migration).toContain(
      "CHECK (kind IN ('plan_applied', 'replan_applied', 'undo_completed'))",
    );
    expect(migration).toContain("BETWEEN 0 AND 500");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).not.toContain("SECURITY DEFINER");
  });

  it("stores no free text or foreign identifiers", () => {
    const table = migration.slice(
      migration.indexOf("CREATE TABLE public.learning_events"),
      migration.indexOf("REVOKE ALL ON public.learning_events"),
    );
    for (const term of [
      "title",
      "notes",
      "location",
      "task_id",
      "appointment_id",
      "plan_run",
      "calendar",
      "provider",
      "message",
    ]) {
      expect(table).not.toContain(term);
    }
    expect(table).not.toContain("local_hour");
    expect(table).not.toContain("local_dow");
  });
});
