import { describe, expect, it } from "vitest";
import { validatePublicHttpsUrl } from "../src/domain/url.js";

describe("admin application URL validation", () => {
  it("accepts direct HTTPS links and strips tracking", () => {
    expect(
      validatePublicHttpsUrl("https://jobs.example.com/role?utm_source=discord&id=42#apply"),
    ).toEqual({
      ok: true,
      url: "https://jobs.example.com/role?id=42",
      host: "jobs.example.com",
    });
  });

  it.each([
    "http://jobs.example.com/role",
    "https://localhost/role",
    "https://127.0.0.1/role",
    "https://user:pass@jobs.example.com/role",
    "https://bit.ly/example",
    "https://jobs.example.com:8443/role",
  ])("rejects an unsafe link: %s", (value) => {
    expect(validatePublicHttpsUrl(value).ok).toBe(false);
  });
});
