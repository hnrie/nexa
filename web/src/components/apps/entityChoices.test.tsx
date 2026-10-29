// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { PublicUser } from "@/api/types";
import { useUsers } from "@/stores/users";
import { entityLabelNode } from "./entityChoices";

afterEach(cleanup);
it("resolves a selected app identity when its profile arrives and follows later profile updates", () => {
  useUsers.setState({ byId: {} });
  render(<>{entityLabelNode("channel", "person", "user")}</>);
  expect(screen.getByText("person")).toBeTruthy();
  const user = { id: "person", username: "bob", display_name: "Bob", name_style: { font: "comic", effect: "solid", colors: [] } } as unknown as PublicUser;
  act(() => useUsers.setState({ byId: { person: user } }));
  expect(screen.getByText("Bob").className).toContain("ns-font");
  act(() => useUsers.setState({ byId: { person: { ...user, display_name: "Robert", name_style: null } } }));
  expect(screen.getByText("Robert").className).toBe("person-name");
});
