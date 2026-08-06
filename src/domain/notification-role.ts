export interface NotificationCategory {
  program: string;
  cycle: string;
}

export const NOTIFICATION_ROLE_NONE = "none";

export function notificationCategoryKey(category: NotificationCategory): string {
  return `${category.program}|${category.cycle}`;
}

export function parseNotificationCategoryKey(value: string): NotificationCategory | null {
  const [program, cycle, extra] = value.split("|");
  if (extra || !program || !cycle) return null;
  if (!/^[a-z][a-z-]{0,30}$/.test(program) || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(cycle)) {
    return null;
  }
  return { program, cycle };
}

export function notificationCategoryLabel(category: NotificationCategory): string {
  const program =
    category.program === "internship"
      ? "Internship"
      : category.program === "new-grad"
        ? "New graduate"
        : "Experienced";
  const cycle = category.cycle
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `${program} · ${cycle}`;
}

export function notificationRoleName(category: NotificationCategory): string {
  return `Stentor · ${notificationCategoryLabel(category)}`.slice(0, 100);
}
