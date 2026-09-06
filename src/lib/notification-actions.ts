export type NotificationTargetType = "task" | "appointment" | "planner" | null;
export type NotificationAction =
  | "done"
  | "snooze"
  | "reschedule"
  | "review_plan"
  | "open_navigation"
  | "open"
  | "dismiss";

export type ActionableNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  target_type: NotificationTargetType;
  target_id: string | null;
};

export type NotificationActionOption = {
  id: NotificationAction;
  label: string;
};

export function actionsForNotification(
  notification: Pick<ActionableNotification, "kind" | "target_type">,
): NotificationActionOption[] {
  if (notification.target_type === "task") {
    return [
      { id: "done", label: "Done" },
      { id: "snooze", label: "Snooze" },
      { id: "reschedule", label: "Reschedule" },
    ];
  }
  if (notification.target_type === "appointment") {
    return [
      { id: "open_navigation", label: "Navigate" },
      { id: "snooze", label: "Snooze" },
      { id: "reschedule", label: "Reschedule" },
    ];
  }
  if (notification.target_type === "planner" || notification.kind === "nudge") {
    return [
      { id: "review_plan", label: "Review plan" },
      { id: "snooze", label: "Snooze" },
    ];
  }
  return [
    { id: "open", label: "Open" },
    { id: "snooze", label: "Snooze" },
  ];
}

export function notificationActionUrl(id: string, action: NotificationAction) {
  const search = new URLSearchParams({ notificationId: id, action });
  return `/notification-action?${search.toString()}`;
}

export function navigationUrl(location: string) {
  const search = new URLSearchParams({ api: "1", query: location });
  return `https://www.google.com/maps/search/?${search.toString()}`;
}
