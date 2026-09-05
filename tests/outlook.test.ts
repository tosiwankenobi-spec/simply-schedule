import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  appointmentRowsAreEqual,
  backoffDelayMs,
  isAuthFailure,
  isDeltaResyncRequired,
  isRetryable,
  normalizeGraphEvent,
  outlookEventKey,
  readDeltaPage,
} from "../src/lib/outlook";
import { decryptConnectionKey, encryptConnectionKey } from "../src/server/connectionKeyCrypto";

const secret = randomBytes(32);

describe("connection key encryption", () => {
  test("round-trips the opaque connection key", () => {
    const key = "lovack_abc123_example";
    const stored = encryptConnectionKey(key, secret);
    expect(stored).not.toContain("lovack_");
    expect(decryptConnectionKey(stored, secret)).toBe(key);
  });

  test("uses a fresh nonce for every write", () => {
    const a = encryptConnectionKey("lovack_x", secret);
    const b = encryptConnectionKey("lovack_x", secret);
    expect(a).not.toBe(b);
  });

  test("rejects tampered ciphertext", () => {
    const stored = encryptConnectionKey("lovack_x", secret);
    const buf = Buffer.from(stored, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptConnectionKey(buf.toString("base64"), secret)).toThrow();
  });

  test("cannot be read with a different secret", () => {
    const stored = encryptConnectionKey("lovack_x", secret);
    expect(() => decryptConnectionKey(stored, randomBytes(32))).toThrow();
  });
});

describe("event normalization", () => {
  test("maps a timed Outlook event", () => {
    const ev = normalizeGraphEvent({
      id: "AAMk123",
      subject: "Design review",
      bodyPreview: "Agenda inside",
      start: { dateTime: "2026-09-08T15:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-09-08T16:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "Studio" },
      showAs: "busy",
      changeKey: "ck1",
      lastModifiedDateTime: "2026-09-05T10:00:00Z",
    });
    expect(ev).not.toBeNull();
    expect(ev!.title).toBe("Design review");
    expect(ev!.starts_at).toBe("2026-09-08T15:00:00.000Z");
    expect(ev!.ends_at).toBe("2026-09-08T16:00:00.000Z");
    expect(ev!.location).toBe("Studio");
    expect(ev!.commitment_type).toBe("fixed");
    expect(ev!.removed).toBe(false);
  });

  test("treats free/tentative events as flexible and keeps all-day flags", () => {
    const ev = normalizeGraphEvent({
      id: "e2",
      subject: "Focus",
      isAllDay: true,
      showAs: "free",
      start: { dateTime: "2026-09-08T00:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-09-09T00:00:00", timeZone: "UTC" },
    });
    expect(ev!.is_all_day).toBe(true);
    expect(ev!.commitment_type).toBe("flexible");
  });

  test("marks removed and cancelled events", () => {
    expect(normalizeGraphEvent({ id: "e3", "@removed": { reason: "deleted" } })!.removed).toBe(
      true,
    );
    expect(
      normalizeGraphEvent({
        id: "e4",
        isCancelled: true,
        start: { dateTime: "2026-09-08T15:00:00", timeZone: "UTC" },
      })!.removed,
    ).toBe(true);
  });

  test("skips unusable payloads", () => {
    expect(normalizeGraphEvent({ subject: "no id" })).toBeNull();
    expect(normalizeGraphEvent({ id: "e5", subject: "no start" })).toBeNull();
  });

  test("falls back to a readable title", () => {
    const ev = normalizeGraphEvent({
      id: "e6",
      subject: "   ",
      start: { dateTime: "2026-09-08T15:00:00", timeZone: "UTC" },
    });
    expect(ev!.title).toBe("(untitled Outlook event)");
  });
});

describe("dedupe and deletion isolation", () => {
  test("event keys are scoped by provider, account and calendar", () => {
    const a = outlookEventKey("me", "cal-1", "AAMk");
    const b = outlookEventKey("me", "cal-2", "AAMk");
    expect(a).not.toBe(b);
    expect(a.startsWith("microsoft_outlook:")).toBe(true);
  });

  test("a Google event id can never collide with an Outlook key", () => {
    const googleId = "abc123googleevent";
    expect(outlookEventKey("me", "cal-1", googleId)).not.toBe(googleId);
  });

  test("unchanged rows are detected so no needless write happens", () => {
    const row = { title: "A", starts_at: "x", ends_at: "y", location: null };
    expect(appointmentRowsAreEqual(row, { ...row })).toBe(true);
    expect(appointmentRowsAreEqual(row, { ...row, title: "B" })).toBe(false);
  });
});

describe("pagination and delta fallback", () => {
  test("reads next and delta links", () => {
    const page = readDeltaPage({
      value: [{ id: "1" }, { id: "2" }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextLink).toBe("https://graph.microsoft.com/v1.0/next");
    expect(page.deltaLink).toBeNull();

    const last = readDeltaPage({ value: [], "@odata.deltaLink": "https://graph/delta?token=x" });
    expect(last.deltaLink).toBe("https://graph/delta?token=x");
  });

  test("tolerates malformed bodies", () => {
    expect(readDeltaPage(null).items).toEqual([]);
    expect(readDeltaPage({ value: "nope" }).items).toEqual([]);
  });

  test("detects expired delta state", () => {
    expect(isDeltaResyncRequired(410, "")).toBe(true);
    expect(isDeltaResyncRequired(400, '{"error":{"code":"resyncRequired"}}')).toBe(true);
    expect(isDeltaResyncRequired(400, '{"error":{"code":"invalidRequest"}}')).toBe(false);
    expect(isDeltaResyncRequired(500, "")).toBe(false);
  });

  test("classifies auth and retryable failures", () => {
    expect(isAuthFailure(401)).toBe(true);
    expect(isAuthFailure(403)).toBe(true);
    expect(isAuthFailure(429)).toBe(false);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(404)).toBe(false);
  });

  test("backoff grows and stays bounded", () => {
    const a = backoffDelayMs(1, 0.5);
    const b = backoffDelayMs(3, 0.5);
    expect(b).toBeGreaterThan(a);
    expect(backoffDelayMs(20, 1)).toBeLessThanOrEqual(8000);
  });
});
