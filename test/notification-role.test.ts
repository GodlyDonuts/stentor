import { describe, expect, it } from "vitest";
import {
  notificationCategoryKey,
  notificationCategoryLabel,
  notificationRoleName,
  parseNotificationCategoryKey,
} from "../src/domain/notification-role.js";
import { notificationRolePicker } from "../src/discord/presentation.js";

describe("notification roles", () => {
  const category = { program: "internship", cycle: "spring-2027" };

  it("uses stable, readable category identifiers and role names", () => {
    expect(notificationCategoryKey(category)).toBe("internship|spring-2027");
    expect(notificationCategoryLabel(category)).toBe("Internship · Spring 2027");
    expect(notificationRoleName(category)).toBe("Stentor · Internship · Spring 2027");
  });

  it("parses valid menu values and rejects injected or malformed values", () => {
    expect(parseNotificationCategoryKey("internship|spring-2027")).toEqual(category);
    expect(parseNotificationCategoryKey("internship|spring-2027|extra")).toBeNull();
    expect(parseNotificationCategoryKey("internship|../../admin")).toBeNull();
  });

  it("keeps the self-service picker within Discord's 25-option limit", () => {
    const categories = Array.from({ length: 24 }, (_, index) => ({
      program: "internship",
      cycle: `cycle-${index}`,
    }));
    const picker = notificationRolePicker(categories, [categories[0]!]).toJSON();
    const menu = picker.components[0];

    expect(menu?.options).toHaveLength(25);
    expect(menu?.max_values).toBe(24);
    expect(menu?.options.find((option) => option.value === "internship|cycle-0")?.default).toBe(
      true,
    );
  });
});
