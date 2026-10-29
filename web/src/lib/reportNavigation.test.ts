import { describe, it, expect } from "vitest";
import { reportReturnPath } from "./reportNavigation";
describe("staff report return navigation", () => {
  it("keeps the exact report and queue filters", () => {
    expect(
      reportReturnPath({
        reportReturnTo: "/channels/@admin/reports/123?status=active&q=spam",
      }),
    ).toBe("/channels/@admin/reports/123?status=active&q=spam");
  });
  it("rejects unrelated or malformed destinations", () => {
    for (const value of [
      null,
      {},
      "/channels/@admin/reports/123",
      { reportReturnTo: "https://other.example" },
      { reportReturnTo: "/channels/@admin/servers/123" },
      { reportReturnTo: "/channels/@admin/reports/../users" },
    ])
      expect(reportReturnPath(value)).toBeNull();
  });
});
