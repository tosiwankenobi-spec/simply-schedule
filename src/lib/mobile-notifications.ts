import { Capacitor } from "@capacitor/core";
import {
  actionsForNotification,
  notificationActionUrl,
  type ActionableNotification,
  type NotificationAction,
} from "./notification-actions";

export type DevicePermission = "granted" | "denied" | "default" | "unsupported";

const ACTION_IDS = new Set<NotificationAction>([
  "done",
  "snooze",
  "reschedule",
  "review_plan",
  "open_navigation",
  "open",
  "dismiss",
]);

let initialization: Promise<void> | null = null;

function nativeActionType(notification: Pick<ActionableNotification, "target_type">) {
  if (notification.target_type === "task") return "chronos-task";
  if (notification.target_type === "appointment") return "chronos-appointment";
  return "chronos-plan";
}

function integerId(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(index)) | 0;
  }
  return hash & 0x7fffffff || 1;
}

function openAction(notificationId: string, action: string) {
  const selected = ACTION_IDS.has(action as NotificationAction)
    ? (action as NotificationAction)
    : "open";
  window.location.assign(notificationActionUrl(notificationId, selected));
}

async function registerWebWorker() {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/chronos-sw.js", { scope: "/" });
}

async function registerNativeActions() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: "chronos-task",
        actions: [
          { id: "done", title: "Done", foreground: true, requiresAuthentication: true },
          { id: "snooze", title: "Snooze 15m", foreground: true },
          { id: "reschedule", title: "Reschedule", foreground: true },
        ],
      },
      {
        id: "chronos-appointment",
        actions: [
          { id: "open_navigation", title: "Navigate", foreground: true },
          { id: "snooze", title: "Snooze 15m", foreground: true },
          { id: "reschedule", title: "Reschedule", foreground: true },
        ],
      },
      {
        id: "chronos-plan",
        actions: [
          { id: "review_plan", title: "Review plan", foreground: true },
          { id: "snooze", title: "Snooze 15m", foreground: true },
        ],
      },
    ],
  });
  await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const extra = event.notification.extra as { notificationId?: unknown } | null;
    if (typeof extra?.notificationId !== "string") return;
    openAction(extra.notificationId, event.actionId);
  });
}

export function initializeNotificationDelivery() {
  if (typeof window === "undefined") return Promise.resolve();
  initialization ??= (
    Capacitor.isNativePlatform() ? registerNativeActions() : registerWebWorker()
  ).catch((error) => {
    initialization = null;
    console.warn("Notification actions could not be initialized", error);
  });
  return initialization;
}

export async function getDeviceNotificationPermission(): Promise<DevicePermission> {
  if (typeof window === "undefined") return "unsupported";
  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.checkPermissions();
    if (status.display === "granted") return "granted";
    if (status.display === "denied") return "denied";
    return "default";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestDeviceNotificationPermission(): Promise<DevicePermission> {
  if (typeof window === "undefined") return "unsupported";
  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.requestPermissions();
    if (status.display === "granted") return "granted";
    if (status.display === "denied") return "denied";
    return "default";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export async function showActionableDeviceNotification(notification: ActionableNotification) {
  if (typeof window === "undefined") return false;
  await initializeNotificationDelivery();
  if ((await getDeviceNotificationPermission()) !== "granted") return false;

  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [
        {
          id: integerId(notification.id),
          title: notification.title,
          body: notification.body,
          actionTypeId: nativeActionType(notification),
          extra: { notificationId: notification.id },
        },
      ],
    });
    return true;
  }

  const notificationApi = Notification as typeof Notification & { maxActions?: number };
  const actionOptions = actionsForNotification(notification)
    .slice(0, Math.max(0, notificationApi.maxActions ?? 2))
    .map((action) => ({ action: action.id, title: action.label }));
  const options: NotificationOptions & {
    actions?: { action: string; title: string }[];
  } = {
    body: notification.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: notification.id,
    data: { notificationId: notification.id },
    actions: actionOptions,
  };
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(notification.title, options);
    return true;
  }

  try {
    const shown = new Notification(notification.title, {
      body: notification.body,
      icon: "/icons/icon-192.png",
      tag: notification.id,
    });
    shown.onclick = () => openAction(notification.id, "open");
    return true;
  } catch {
    return false;
  }
}

export async function showTestDeviceNotification() {
  if (typeof window === "undefined") return false;
  await initializeNotificationDelivery();
  if ((await requestDeviceNotificationPermission()) !== "granted") return false;
  const title = "Chronos-V test reminder";
  const body = "Device notifications and reminder actions are ready.";

  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [{ id: integerId(`test-${Date.now()}`), title, body }],
    });
    return true;
  }

  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "chronos-test",
    });
    return true;
  }
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png", tag: "chronos-test" });
    return true;
  } catch {
    return false;
  }
}
