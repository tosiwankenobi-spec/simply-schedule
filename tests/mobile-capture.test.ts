import { describe, expect, test } from "vitest";
import {
  MAX_QUEUED_CAPTURES,
  MOBILE_CAPTURE_STORAGE_KEY,
  enqueueCapture,
  readQueuedCaptures,
  removeQueuedCapture,
  type CaptureStorage,
} from "../src/lib/mobile-capture";

function memoryStorage(): CaptureStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("offline mobile capture", () => {
  test("stores trimmed text locally and removes it after review", () => {
    const storage = memoryStorage();
    const queued = enqueueCapture("  Dentist Thursday at 2  ", {
      storage,
      now: new Date("2026-09-06"),
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.text).toBe("Dentist Thursday at 2");
    expect(readQueuedCaptures({ storage })).toEqual(queued);
    expect(removeQueuedCapture(queued[0]!.id, { storage })).toEqual([]);
    expect(storage.values.has(MOBILE_CAPTURE_STORAGE_KEY)).toBe(false);
  });

  test("deduplicates matching notes and keeps the queue bounded", () => {
    const storage = memoryStorage();
    enqueueCapture("same note", { storage });
    enqueueCapture("same note", { storage });
    for (let index = 0; index < MAX_QUEUED_CAPTURES + 5; index++) {
      enqueueCapture(`note ${index}`, { storage });
    }

    const queued = readQueuedCaptures({ storage });
    expect(queued).toHaveLength(MAX_QUEUED_CAPTURES);
    expect(queued.filter((item) => item.text === "same note")).toHaveLength(0);
    expect(queued[0]?.text).toBe(`note ${MAX_QUEUED_CAPTURES + 4}`);
  });

  test("ignores malformed or oversized local data", () => {
    const storage = memoryStorage();
    storage.setItem(MOBILE_CAPTURE_STORAGE_KEY, "not-json");
    expect(readQueuedCaptures({ storage })).toEqual([]);
    storage.setItem(
      MOBILE_CAPTURE_STORAGE_KEY,
      JSON.stringify([{ id: "bad", text: "x".repeat(2001), createdAt: new Date().toISOString() }]),
    );
    expect(readQueuedCaptures({ storage })).toEqual([]);
  });

  test("isolates private offline notes by signed-in account", () => {
    const storage = memoryStorage();
    enqueueCapture("private for user A", { storage, scope: "user-a" });

    expect(readQueuedCaptures({ storage, scope: "user-a" })).toHaveLength(1);
    expect(readQueuedCaptures({ storage, scope: "user-b" })).toEqual([]);
  });
});
