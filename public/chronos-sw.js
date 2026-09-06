self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId;
  if (typeof notificationId !== "string") return;

  const supported = new Set([
    "done",
    "snooze",
    "reschedule",
    "review_plan",
    "open_navigation",
    "open",
    "dismiss",
  ]);
  const action = supported.has(event.action) ? event.action : "open";
  const url = new URL("/notification-action", self.location.origin);
  url.searchParams.set("notificationId", notificationId);
  url.searchParams.set("action", action);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows[0];
      if (existing) return existing.navigate(url.href).then(() => existing.focus());
      return clients.openWindow(url.href);
    }),
  );
});
