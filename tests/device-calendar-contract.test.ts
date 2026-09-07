import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const client = readFileSync(resolve(root, "src/lib/device-calendar.ts"), "utf8");
const server = readFileSync(resolve(root, "src/lib/device-calendar.functions.ts"), "utf8");
const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");

describe("native device calendar security contract", () => {
  test("requests only read access and never invokes native write methods", () => {
    expect(client).toContain('permissions: ["readCalendar"]');
    expect(client).toContain('import("@capacitor/calendar")');
    expect(client).toMatch(/\.filter\(\(item\) => selectedIds\.has\(item\.id\)\)/);
    expect(client).toMatch(/calendar\.findEvents\(\{[\s\S]*?calendarName,/);
    expect(client).not.toMatch(/\.createEvent\s*\(/);
    expect(client).not.toMatch(/\.modifyEvent\s*\(/);
    expect(client).not.toMatch(/\.deleteEvent\s*\(/);
    expect(client).not.toMatch(/\.createCalendar\s*\(/);
    expect(client).not.toMatch(/\.deleteCalendar\s*\(/);
  });

  test("removes Android write-calendar permission from the merged manifest", () => {
    expect(manifest).toMatch(
      /android:name="android\.permission\.WRITE_CALENDAR"[\s\S]*?tools:node="remove"/,
    );
    expect(manifest).toContain('android:name="android.permission.READ_CALENDAR"');
  });

  test("authenticates every server operation and scopes mutations to the owner and device", () => {
    expect(server.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)).toHaveLength(3);
    expect(server).toContain('.eq("user_id", context.userId)');
    expect(server).toContain('.eq("provider", "device_calendar")');
    expect(server).toContain('.eq("provider_account_id", data.deviceId)');
    expect(server).toContain('source: "calendar_import"');
    expect(server).toContain("calendar_event_id: null");
  });

  test("never reconciles deletions from an incomplete capped preview", () => {
    expect(server).toMatch(/if \(calendar\.truncated\) continue;[\s\S]*?\.delete\(\)/);
  });
});
