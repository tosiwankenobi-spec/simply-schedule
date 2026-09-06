import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260906170754_mobile_capture_notification_actions.sql"),
  "utf8",
);
const functions = readFileSync(resolve(root, "src/lib/notifications.functions.ts"), "utf8");
const manifest = readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8");
const androidManifest = readFileSync(
  resolve(root, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);

describe("notification action security contract", () => {
  test("keeps the action RPC in caller context with a fixed search path", () => {
    expect(migration).toMatch(/FUNCTION public\.act_on_notification[\s\S]*?SECURITY INVOKER/);
    expect(migration).toMatch(/FUNCTION public\.act_on_notification[\s\S]*?SET search_path = ''/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.act_on_notification[\s\S]*?FROM PUBLIC/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.act_on_notification[\s\S]*?FROM anon/,
    );
  });

  test("locks every action to the authenticated owner and validates target ownership", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("AND user_id = v_user_id");
    expect(migration).toMatch(/UPDATE public\.tasks[\s\S]*?AND user_id = v_user_id/);
    expect(migration).toMatch(/FROM public\.appointments[\s\S]*?AND user_id = v_user_id/);
  });

  test("uses optimized owner-scoped RLS and least-privilege table grants", () => {
    expect(migration).toContain("ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING ((SELECT auth.uid()) = user_id)");
    expect(migration).toContain("WITH CHECK ((SELECT auth.uid()) = user_id)");
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE ON public.notification_log TO authenticated",
    );
    expect(migration).not.toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO authenticated",
    );
  });

  test("passes only server-generated target metadata into the notification log", () => {
    expect(functions).toContain("target_type: n.target_type");
    expect(functions).toContain("target_id: n.target_id");
    expect(functions).toContain('.rpc("act_on_notification"');
  });

  test("exposes capture through an installable shortcut and OS share target", () => {
    const parsed = JSON.parse(manifest) as {
      shortcuts?: { url: string }[];
      share_target?: unknown;
    };
    expect(parsed.shortcuts?.some((shortcut) => shortcut.url === "/capture")).toBe(true);
    expect(parsed.share_target).toBeTruthy();
  });

  test("does not request Android exact-alarm access for immediate reminders", () => {
    expect(androidManifest).toMatch(
      /android:name="android\.permission\.SCHEDULE_EXACT_ALARM"[\s\S]*?tools:node="remove"/,
    );
  });
});
