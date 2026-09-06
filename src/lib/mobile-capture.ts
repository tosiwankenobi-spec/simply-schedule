export const MOBILE_CAPTURE_STORAGE_KEY = "chronos-v.mobile-capture.v1";
export const MAX_QUEUED_CAPTURES = 20;
export const MAX_CAPTURE_LENGTH = 2000;

export type QueuedCapture = {
  id: string;
  text: string;
  createdAt: string;
};

export type CaptureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type CaptureStorageOptions = {
  storage?: CaptureStorage | null;
  scope?: string;
};

type EnqueueCaptureOptions = CaptureStorageOptions & {
  now?: Date;
};

function storageOrNull(storage?: CaptureStorage | null) {
  if (storage !== undefined) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function storageKey(scope?: string) {
  return scope ? `${MOBILE_CAPTURE_STORAGE_KEY}.${scope}` : MOBILE_CAPTURE_STORAGE_KEY;
}

function validCapture(value: unknown): value is QueuedCapture {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedCapture>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.text === "string" &&
    item.text.trim().length > 0 &&
    item.text.length <= MAX_CAPTURE_LENGTH &&
    typeof item.createdAt === "string" &&
    Number.isFinite(Date.parse(item.createdAt))
  );
}

export function readQueuedCaptures(options: CaptureStorageOptions = {}): QueuedCapture[] {
  const target = storageOrNull(options.storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(storageKey(options.scope)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validCapture).slice(0, MAX_QUEUED_CAPTURES);
  } catch {
    return [];
  }
}

function writeQueuedCaptures(items: QueuedCapture[], options: CaptureStorageOptions = {}) {
  const target = storageOrNull(options.storage);
  if (!target) return;
  if (items.length === 0) {
    target.removeItem(storageKey(options.scope));
    return;
  }
  target.setItem(storageKey(options.scope), JSON.stringify(items.slice(0, MAX_QUEUED_CAPTURES)));
}

export function enqueueCapture(text: string, options: EnqueueCaptureOptions = {}): QueuedCapture[] {
  const cleaned = text.trim().slice(0, MAX_CAPTURE_LENGTH);
  if (!cleaned) return readQueuedCaptures(options);
  const existing = readQueuedCaptures(options).filter((item) => item.text !== cleaned);
  const now = options.now ?? new Date();
  const item: QueuedCapture = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${now.getTime()}-${Math.random().toString(36).slice(2)}`,
    text: cleaned,
    createdAt: now.toISOString(),
  };
  const next = [item, ...existing].slice(0, MAX_QUEUED_CAPTURES);
  writeQueuedCaptures(next, options);
  return next;
}

export function removeQueuedCapture(
  id: string,
  options: CaptureStorageOptions = {},
): QueuedCapture[] {
  const next = readQueuedCaptures(options).filter((item) => item.id !== id);
  writeQueuedCaptures(next, options);
  return next;
}

export function isLikelyOfflineError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}
