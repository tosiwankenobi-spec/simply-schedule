import { describe, expect, test } from "bun:test";
import { summarizeWelcomeProgress } from "../src/lib/welcome-progress";

describe("welcome progress", () => {
  test("starts empty without inventing completion", () => {
    expect(
      summarizeWelcomeProgress({
        profileCount: 0,
        calendarSyncCount: 0,
        importedCalendarEventCount: 0,
        taskCount: 0,
      }),
    ).toEqual({
      rhythmReady: false,
      calendarReady: false,
      taskCaptured: false,
      completed: 0,
      total: 3,
    });
  });

  test("recognizes a successful calendar sync or an imported calendar event", () => {
    const synced = summarizeWelcomeProgress({
      profileCount: 1,
      calendarSyncCount: 1,
      importedCalendarEventCount: 0,
      taskCount: 0,
    });
    const imported = summarizeWelcomeProgress({
      profileCount: 1,
      calendarSyncCount: 0,
      importedCalendarEventCount: 2,
      taskCount: 1,
    });

    expect(synced.calendarReady).toBe(true);
    expect(synced.completed).toBe(2);
    expect(imported.calendarReady).toBe(true);
    expect(imported.completed).toBe(3);
  });
});
