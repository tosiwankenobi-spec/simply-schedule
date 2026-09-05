import { describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import {
  appointmentRowsAreEqual,
  backoffDelayMs,
  isAuthFailure,
  isDeltaResyncRequired,
  isRetryable,
  graphErrorSummary,
  normalizeGraphEvent,
  rowToGraphEvent,
  toIanaZone,
  outlookEventKey,
  readDeltaPage,
  pullStartUrl,
  walkDeltaPages,
  lockIsStale,
  type LockRow,
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

describe("time zone fidelity when sending events", () => {
  test("keeps the event's own zone instead of forcing UTC", () => {
    const payload = rowToGraphEvent({
      title: "Dentist",
      starts_at: "2026-03-10T13:30:00.000Z",
      ends_at: "2026-03-10T14:00:00.000Z",
      location: "Main St",
      notes: null,
      is_all_day: false,
      timezone: "America/Toronto",
    }) as { start: { dateTime: string; timeZone: string }; isAllDay: boolean };
    expect(payload.start.timeZone).toBe("America/Toronto");
    expect(payload.start.dateTime).toBe("2026-03-10T09:30:00");
    expect(payload.isAllDay).toBe(false);
  });

  test("all-day events sit on midnight boundaries and end the next day", () => {
    const payload = rowToGraphEvent({
      title: "Holiday",
      starts_at: "2026-07-01T04:00:00.000Z",
      ends_at: null,
      location: null,
      notes: null,
      is_all_day: true,
      timezone: "America/Toronto",
    }) as { start: { dateTime: string }; end: { dateTime: string } };
    expect(payload.start.dateTime).toBe("2026-07-01T00:00:00");
    expect(payload.end.dateTime).toBe("2026-07-02T00:00:00");
  });

  test("Windows zone names are mapped to standard ones", () => {
    expect(toIanaZone("Eastern Standard Time")).toBe("America/New_York");
    expect(toIanaZone("nonsense/zone")).toBe("UTC");
  });
});

describe("error reporting never leaks provider data", () => {
  test("keeps only status, code and request id", () => {
    const body = JSON.stringify({
      error: { code: "InvalidAuthenticationToken", message: "Bearer lovack_secret_value" },
    });
    const summary = graphErrorSummary(401, body, "req-42");
    expect(summary).toBe(
      "Microsoft responded 401 · code InvalidAuthenticationToken · request req-42",
    );
    expect(summary).not.toContain("lovack");
    expect(summary).not.toContain("Bearer");
  });

  test("discards non-JSON bodies entirely", () => {
    const summary = graphErrorSummary(500, "<html>token=abc123</html>");
    expect(summary).toBe("Microsoft responded 500");
    expect(summary).not.toContain("abc123");
  });
});

describe("resumable pagination", () => {
  test("an unfinished chain resumes from the stored continuation link", () => {
    expect(pullStartUrl({ syncToken: "delta-1", pendingNextLink: "page-9" }, "fresh")).toBe(
      "page-9",
    );
    expect(pullStartUrl({ syncToken: "delta-1", pendingNextLink: null }, "fresh")).toBe("delta-1");
    expect(pullStartUrl(null, "fresh")).toBe("fresh");
  });

  test("a capped run resumes rather than looping or skipping pages", async () => {
    // 6 pages of one event each; the chain only ends on the last page.
    const chain = new Map<string, { id: string; next: string | null; delta: string | null }>();
    for (let i = 0; i < 6; i++) {
      chain.set(i === 0 ? "fresh" : `page-${i}`, {
        id: `e${i}`,
        next: i < 5 ? `page-${i + 1}` : null,
        delta: i === 5 ? "delta-final" : null,
      });
    }
    const fetched: string[] = [];
    const collected: string[] = [];
    const fetchPage = async (url: string) => {
      fetched.push(url);
      const node = chain.get(url)!;
      return {
        kind: "page" as const,
        items: [{ id: node.id } as never],
        nextLink: node.next,
        deltaLink: node.delta,
      };
    };
    const onItems = async (items: Array<{ id?: string }>) => {
      for (const i of items) collected.push(i.id!);
    };

    // Persisted state, exactly as the engine stores it.
    let position = { syncToken: null as string | null, pendingNextLink: null as string | null };
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const walk = await walkDeltaPages({
        startUrl: pullStartUrl(position, "fresh"),
        freshUrl: "fresh",
        maxPages: 2,
        fetchPage,
        onItems,
      });
      runs.push(walk.pages);
      position = {
        syncToken: walk.pendingNextLink ? position.syncToken : walk.deltaLink,
        pendingNextLink: walk.pendingNextLink,
      };
    }

    expect(runs).toEqual([2, 2, 2]);
    expect(collected).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"]);
    expect(new Set(fetched).size).toBe(fetched.length); // no page fetched twice
    expect(position.pendingNextLink).toBeNull();
    expect(position.syncToken).toBe("delta-final");
  });

  test("a completed chain records the delta link and clears the continuation", async () => {
    const walk = await walkDeltaPages({
      startUrl: "fresh",
      freshUrl: "fresh",
      maxPages: 10,
      fetchPage: async () => ({ kind: "page", items: [], nextLink: null, deltaLink: "d1" }),
      onItems: async () => {},
    });
    expect(walk.deltaLink).toBe("d1");
    expect(walk.pendingNextLink).toBeNull();
    expect(walk.error).toBeNull();
  });

  test("an expired delta restarts once from the fresh window", async () => {
    let calls = 0;
    const walk = await walkDeltaPages({
      startUrl: "stale-delta",
      freshUrl: "fresh",
      maxPages: 5,
      fetchPage: async (url) => {
        calls++;
        if (url === "stale-delta") return { kind: "resync" };
        return { kind: "page", items: [], nextLink: null, deltaLink: "d2" };
      },
      onItems: async () => {},
    });
    expect(calls).toBe(2);
    expect(walk.usedFallback).toBe(true);
    expect(walk.deltaLink).toBe("d2");
  });

  test("a failure keeps the last good continuation instead of a delta link", async () => {
    const walk = await walkDeltaPages({
      startUrl: "fresh",
      freshUrl: "fresh",
      maxPages: 5,
      fetchPage: async (url) =>
        url === "fresh"
          ? { kind: "page", items: [], nextLink: "page-1", deltaLink: null }
          : { kind: "error", message: "Microsoft responded 503" },
      onItems: async () => {},
    });
    expect(walk.error).toBe("Microsoft responded 503");
    expect(walk.pendingNextLink).toBe("page-1");
    expect(walk.deltaLink).toBeNull();
  });
});

describe("sync lock semantics", () => {
  // Mirrors public.claim_sync_lock / release_sync_lock: a single atomic
  // insert-or-takeover keyed by (user_id, lock_key).
  function makeLockStore() {
    const rows = new Map<string, LockRow>();
    let n = 0;
    return {
      claim(userId: string, lockKey: string, nowMs: number, ttlMs: number): string | null {
        const k = `${userId}|${lockKey}`;
        const existing = rows.get(k) ?? null;
        if (existing && !lockIsStale(existing, nowMs, ttlMs)) return null;
        const token = `t${++n}`;
        rows.set(k, { userId, lockKey, token, claimedAtMs: nowMs });
        return token;
      },
      release(userId: string, lockKey: string, token: string): boolean {
        const k = `${userId}|${lockKey}`;
        const existing = rows.get(k);
        if (!existing || existing.userId !== userId || existing.token !== token) return false;
        rows.delete(k);
        return true;
      },
    };
  }

  const TTL = 300000;

  test("only one of two concurrent claims wins", () => {
    const store = makeLockStore();
    const a = store.claim("u1", "outlook", 1000, TTL);
    const b = store.claim("u1", "outlook", 1001, TTL);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  test("releasing lets the next run claim again (idempotent cycles)", () => {
    const store = makeLockStore();
    const a = store.claim("u1", "outlook", 1000, TTL)!;
    expect(store.release("u1", "outlook", a)).toBe(true);
    expect(store.release("u1", "outlook", a)).toBe(false);
    expect(store.claim("u1", "outlook", 1002, TTL)).not.toBeNull();
  });

  test("a stale lock is recovered after the timeout", () => {
    const store = makeLockStore();
    store.claim("u1", "outlook", 0, TTL);
    expect(store.claim("u1", "outlook", TTL - 1, TTL)).toBeNull();
    expect(store.claim("u1", "outlook", TTL + 1, TTL)).not.toBeNull();
  });

  test("a stale token cannot release the new owner's lock", () => {
    const store = makeLockStore();
    const stale = store.claim("u1", "outlook", 0, TTL)!;
    const fresh = store.claim("u1", "outlook", TTL + 1, TTL)!;
    expect(store.release("u1", "outlook", stale)).toBe(false);
    expect(store.release("u1", "outlook", fresh)).toBe(true);
  });

  test("locks never cross users", () => {
    const store = makeLockStore();
    const a = store.claim("u1", "outlook", 1000, TTL)!;
    expect(store.claim("u2", "outlook", 1000, TTL)).not.toBeNull();
    expect(store.release("u2", "outlook", a)).toBe(false);
  });
});
