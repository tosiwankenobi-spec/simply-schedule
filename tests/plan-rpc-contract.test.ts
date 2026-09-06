/**
 * Contract tests for the planner's apply/undo database routines.
 *
 * These read the SQL that is actually in force (the newest migration that
 * defines the routines) and assert each safety rule is present. Every case
 * below fails when checked against migration 20260905214115, which had
 * weakened the routines, and passes against the corrective migration.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const WEAK_MIGRATION = "20260905214115_f4cdb3a5-4113-4c6a-b810-adfbe706c48b.sql";

function readMigration(file: string) {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

/** The newest migration that (re)defines the routines is the one in force. */
function effectiveSql() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const sql = readMigration(files[i] as string);
    if (sql.includes("FUNCTION public.apply_day_replan")) return { file: files[i] as string, sql };
  }
  throw new Error("No migration defines apply_day_replan");
}

function section(sql: string, fnSignature: string) {
  const start = sql.indexOf(fnSignature);
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start + fnSignature.length);
  const end = rest.indexOf("\n$$;");
  return rest.slice(0, end === -1 ? rest.length : end);
}

const { file: effectiveFile, sql } = effectiveSql();
const weakSql = readMigration(WEAK_MIGRATION);
const apply = section(sql, "FUNCTION public.apply_day_replan");
const undo = section(sql, "FUNCTION public.undo_plan_run");
const weakApply = section(weakSql, "FUNCTION public.apply_day_replan");
const weakUndo = section(weakSql, "FUNCTION public.undo_plan_run");

/** Assert a rule holds now and did not hold in the weakened version. */
function stronger(current: string, weak: string, pattern: RegExp) {
  expect(pattern.test(current)).toBe(true);
  expect(pattern.test(weak)).toBe(false);
}

describe("the routines in force are the corrective ones", () => {
  it("come from a migration later than the weakened one", () => {
    expect(effectiveFile > WEAK_MIGRATION).toBe(true);
  });

  it("keep the caller's own identity and a locked-down search path", () => {
    for (const body of [apply, undo]) {
      expect(body).toMatch(/SECURITY INVOKER/);
      expect(body).toMatch(/SET search_path = ''/);
      expect(body).toMatch(/auth\.uid\(\)/);
      expect(body).not.toMatch(/SECURITY DEFINER/);
    }
  });

  it("are executable only by signed-in callers", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_day_replan[\s\S]*?FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_day_replan[\s\S]*?FROM anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.undo_plan_run[\s\S]*?FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.undo_plan_run[\s\S]*?FROM anon/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_day_replan[\s\S]*?TO authenticated/,
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.undo_plan_run[\s\S]*?TO authenticated/);
  });
});

describe("the repaired plan history table", () => {
  it("is private by default and exposed only through owner-scoped RLS", () => {
    expect(sql).toContain("ALTER TABLE public.plan_runs ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.plan_runs FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON public.plan_runs FROM anon");
    expect(sql).toContain("REVOKE ALL ON public.plan_runs FROM authenticated");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_runs TO authenticated",
    );
    expect(sql).toContain("(SELECT auth.uid()) = user_id");
  });

  it("deduplicates approvals and keeps update timestamps trustworthy", () => {
    expect(sql).toContain("plan_runs_user_preview_uidx");
    expect(sql).toContain("WHERE preview_id IS NOT NULL");
    expect(sql).toContain("plan_runs_set_updated_at");
    expect(sql).toContain("public.set_updated_at()");
  });
});

describe("applying a plan cannot be steered by the browser", () => {
  it("records the stored title, task and source, not the ones sent in", () => {
    expect(apply).toMatch(/'title',\s*v_row\.title/);
    expect(apply).toMatch(/'taskId',\s*v_task\.id/);
    expect(apply).toMatch(/'source',\s*v_row\.source/);
    // The weakened version copied the request's own title and task straight in.
    expect(weakApply).toMatch(/'title',\s*mv->>'title'/);
    expect(weakApply).toMatch(/'taskId',\s*mv->>'taskId'/);
  });

  it("normalises the reason to a known value", () => {
    expect(apply).toMatch(
      /CASE WHEN v_move->>'reason' = 'missed' THEN 'missed' ELSE 'conflict' END/,
    );
    expect(weakApply).toMatch(/'reason',\s*mv->>'reason'/);
  });

  it("refuses the same block twice in one plan", () => {
    stronger(apply, weakApply, /count\(DISTINCT m->>'appointmentId'\)/);
  });

  it("checks the block is still a movable task block and still linked to that task", () => {
    stronger(apply, weakApply, /v_row\.commitment_type <> 'flexible'/);
    stronger(apply, weakApply, /FROM public\.tasks/);
    stronger(apply, weakApply, /v_task\.id <> \(v_move->>'taskId'\)::uuid/);
  });

  it("refuses a block that has become protected or all-day", () => {
    stronger(apply, weakApply, /A protected commitment can never be moved automatically/);
    stronger(apply, weakApply, /v_row\.is_all_day/);
  });

  it("requires the exact original times and the unchanged version stamp", () => {
    expect(apply).toMatch(/v_row\.updated_at <> \(v_move->>'version'\)::timestamptz/);
    expect(apply).toMatch(/v_row\.starts_at <> \(v_move->>'fromStart'\)::timestamptz/);
  });

  it("rejects nonsensical new times and days outside the day being planned", () => {
    stronger(apply, weakApply, /v_to_end <= v_to_start/);
    stronger(apply, weakApply, /NOT BETWEEN p_plan_date - 1 AND p_plan_date \+ 1/);
  });

  it("refuses to push work past its deadline", () => {
    stronger(apply, weakApply, /v_task\.deadline IS NOT NULL/);
  });

  it("locks the affected day deterministically before validating", () => {
    stronger(apply, weakApply, /ORDER BY id/);
    expect(apply).toMatch(/FOR UPDATE/);
  });

  it("rechecks overlaps against moved and unmoved blocks before recording success", () => {
    stronger(apply, weakApply, /A new overlap appeared/);
    expect(apply).toMatch(/JOIN public\.appointments b/);
  });

  it("verifies every write and keeps the whole plan all-or-nothing", () => {
    expect(
      apply.match(/GET DIAGNOSTICS v_updated = ROW_COUNT/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(apply).toMatch(/RAISE EXCEPTION/);
  });

  it("stays safe when two approvals of one proposal race", () => {
    stronger(apply, weakApply, /EXCEPTION WHEN unique_violation THEN/);
    expect(apply).toMatch(/'repeated', true/);
  });

  it("requires the preview id used for idempotency", () => {
    expect(apply).toMatch(/p_preview_id IS NULL/);
  });

  it("keeps the 60-day history limit scoped to the caller", () => {
    stronger(
      apply,
      weakApply,
      /DELETE FROM public\.plan_runs[\s\S]*?user_id = v_user[\s\S]*?60 days/,
    );
  });
});

describe("undoing a plan is careful and repeatable", () => {
  it("locks the run and the affected blocks in a fixed order", () => {
    expect(undo).toMatch(/FROM public\.plan_runs[\s\S]*?FOR UPDATE/);
    stronger(undo, weakUndo, /ORDER BY 1/);
  });

  it("does nothing the second time", () => {
    expect(undo).toMatch(/v_run\.undone_at IS NOT NULL/);
    expect(undo).toMatch(/'repeated', true/);
  });

  it("restores only blocks still exactly where the plan left them", () => {
    expect(undo).toMatch(/v_row\.starts_at = \(v_change->>'toStart'\)::timestamptz/);
    expect(undo).toMatch(/v_row\.ends_at IS NOT DISTINCT FROM \(v_change->>'toEnd'\)::timestamptz/);
  });

  it("never moves something that has since become protected", () => {
    stronger(undo, weakUndo, /v_row\.commitment_type = 'flexible'/);
    stronger(undo, weakUndo, /v_row\.is_all_day = false/);
  });

  it("reports an outcome for every block", () => {
    for (const outcome of ["restored", "already-restored", "changed-since", "missing"]) {
      expect(undo).toContain(`'outcome', '${outcome}'`);
    }
    stronger(undo, weakUndo, /'lines', v_lines/);
  });

  it("confirms the history entry was closed", () => {
    stronger(undo, weakUndo, /AND undone_at IS NULL/);
    expect(undo).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT/);
  });

  it("only ever touches the caller's own rows", () => {
    expect(undo.match(/user_id = v_user/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
