/**
 * Server-contract tests for the capacity forecast server function.
 *
 * The handler talks to Supabase, so these assert the guarantees that must hold
 * in its source: authenticated + user-scoped queries, read-only behaviour, no
 * AI calls, parallel loading, and a response free of sensitive fields.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/capacity-forecast.functions.ts"), "utf8");

describe("capacity forecast server contract", () => {
  it("requires an authenticated session and derives the user from it", () => {
    expect(source).toContain("requireSupabaseAuth");
    expect(source).toContain("context.userId");
    expect(source).not.toMatch(/userId:\s*z\./);
  });

  it("scopes every own-table query to the session user", () => {
    const tables = ["tasks", "planner_profiles", "planner_profile_assignments", "appointments"];
    for (const table of tables) {
      const uses = source.split(`.from("${table}")`).slice(1);
      expect(uses.length).toBeGreaterThan(0);
      for (const chunk of uses) {
        expect(chunk.slice(0, 400)).toContain('.eq("user_id", context.userId)');
      }
    }
  });

  it("never writes: no insert, update, upsert or delete", () => {
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("uses no AI gateway or model call", () => {
    expect(source).not.toMatch(/lovable|openai|gemini|LOVABLE_API_KEY|ai\.gateway/i);
  });

  it("loads independent inputs in parallel rather than in a waterfall", () => {
    expect(source).toContain("await Promise.all([");
    expect(source.match(/await Promise\.all\(\[/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("selects only display fields — no notes, provider or connection metadata", () => {
    const selects = [...source.matchAll(/\.select\(\s*"([^"]+)"|\.select\(\s*\n\s*"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2] ?? "",
    );
    const columns = selects.flatMap((s) => s.split(",").map((c) => c.trim()));
    for (const forbidden of [
      "notes",
      "provider",
      "provider_account_id",
      "calendar_event_id",
      "connection_key",
      "source_metadata",
      "gmail_from",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("validates its input narrowly and bounds the horizon", () => {
    expect(source).toContain("z.string().max(80)");
    expect(source).toContain("min(1).max(21)");
    expect(source).toContain("normalizeTimeZone");
  });
});
