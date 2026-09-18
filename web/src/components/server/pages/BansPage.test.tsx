// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { Ban } from "@/api/types";
import BansPage from "./BansPage";

let answer: () => Promise<{ bans: Ban[]; users: [] }>;
vi.mock("@/api/servers", () => ({
  servers: {
    bans: () => answer(),
    unban: vi.fn(),
  },
}));

afterEach(cleanup);

describe("BansPage", () => {
  it("says the list could not be loaded rather than that nobody is banned", async () => {
    answer = () => Promise.reject(new ApiError(500, "http_500", "boom"));
    render(<BansPage serverId="s1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/No one is banned/i)).toBeNull();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("asks again when told to, and then shows the real, empty list", async () => {
    let tries = 0;
    answer = () => {
      tries += 1;
      return tries === 1 ? Promise.reject(new ApiError(500, "http_500", "boom")) : Promise.resolve({ bans: [], users: [] });
    };
    render(<BansPage serverId="s1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await act(async () => {
      screen.getByRole("button", { name: /try again/i }).click();
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(tries).toBe(2);
    // an empty list is only ever drawn when the server actually said so
    expect(screen.getByText(/No one is banned/i)).toBeTruthy();
  });

  it("draws the bans it was given", async () => {
    answer = () => Promise.resolve({ bans: [{ user_id: "u1", banned_by: "u2", reason: "spam", created_at: 0 } as Ban], users: [] });
    render(<BansPage serverId="s1" />);
    await waitFor(() => expect(screen.queryByText(/No one is banned/i)).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
